import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { cookieOptions, issueSession, sessionFor } from './auth.js';

const EPHEMERAL_SECRET = randomBytes(32).toString('hex');

function sanitizeDisplayName(name, email) {
  const candidate = String(name || email?.split('@')[0] || 'Bạn cờ')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
  return candidate.length >= 2 ? candidate : 'Bạn cờ';
}

function cookieValue(request, name) {
  const prefix = `${name}=`;
  const pair = (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(prefix));
  return pair ? pair.slice(prefix.length) : '';
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function createOAuthService({ db, allowedOrigins, secureCookies, fetchImpl = fetch, config = {} }) {
  const providerFetch=(url,options={})=>fetchImpl(url,{...options,signal:AbortSignal.timeout(10000)});
  const facebookGraphVersion = config.facebookGraphVersion || process.env.FACEBOOK_GRAPH_VERSION || 'v26.0';
  if (!/^v\d+\.0$/.test(facebookGraphVersion)) throw new Error('FACEBOOK_GRAPH_VERSION must have the form v26.0');
  const stateSecret = () => config.stateSecret || process.env.OAUTH_STATE_SECRET || EPHEMERAL_SECRET;
  const creds = provider => provider === 'google'
    ? {
        id: config.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? '',
        secret: config.googleClientSecret ?? process.env.GOOGLE_CLIENT_SECRET ?? '',
        redirect: config.googleRedirectUri ?? process.env.GOOGLE_REDIRECT_URI ?? '',
      }
    : {
        id: config.facebookAppId ?? process.env.FACEBOOK_APP_ID ?? '',
        secret: config.facebookAppSecret ?? process.env.FACEBOOK_APP_SECRET ?? '',
        redirect: config.facebookRedirectUri ?? process.env.FACEBOOK_REDIRECT_URI ?? '',
      };

  const providers = () => ({
    google: Boolean(creds('google').id && creds('google').secret),
    facebook: Boolean(creds('facebook').id && creds('facebook').secret),
  });

  const safeReturnOrigin = candidate => {
    const cleaned = typeof candidate === 'string' ? candidate.trim().replace(/\/$/, '') : '';
    return cleaned && allowedOrigins.includes(cleaned) ? cleaned : (allowedOrigins[0] || 'http://127.0.0.1:5173');
  };

  const redirectUri = (req, provider) => {
    const explicit = creds(provider).redirect;
    if (explicit) return explicit;
    const base = (config.publicApiUrl || process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    return `${base}/api/auth/${provider}/callback`;
  };

  const signState = payload => {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
  };

  const verifyState = raw => {
    if (typeof raw !== 'string' || !raw.includes('.')) return null;
    const [encoded, sig] = raw.split('.');
    if (!encoded || !sig) return null;
    const expected = createHmac('sha256', stateSecret()).update(encoded).digest('base64url');
    if (!safeEqual(sig, expected)) return null;
    try {
      const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
      return data;
    } catch {
      return null;
    }
  };

  const finishError = (res, origin, message) => {
    res.clearCookie('sc_oauth_state', cookieOptions(secureCookies));
    res.redirect(`${origin}/?auth_error=${encodeURIComponent(message)}`);
  };

  async function resolvePlayer({ provider, providerUserId, email, emailVerified, displayName, guestPlayerId }) {
    const normalizedEmail = typeof email === 'string' && email.trim() ? email.trim().toLowerCase().slice(0, 254) : null;
    const cleanName = sanitizeDisplayName(displayName, normalizedEmail);
    const now = Date.now();
    return db.transaction(async client => {
      const existing = await client.query(
        `SELECT p.id, p.display_name, p.account_id
         FROM oauth_identities o
         JOIN players p ON p.account_id = o.account_id
         WHERE o.provider = $1 AND o.provider_user_id = $2`,
        [provider, providerUserId]
      );
      if (existing.rows[0]) return existing.rows[0];

      if (normalizedEmail && emailVerified) {
        const byEmail = await client.query(
          `SELECT a.id AS account_id, p.id, p.display_name
           FROM accounts a
           JOIN players p ON p.account_id = a.id
           WHERE a.email = $1`,
          [normalizedEmail]
        );
        if (byEmail.rows[0]) {
          await client.query(
            'INSERT INTO oauth_identities(provider, provider_user_id, account_id, email, created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
            [provider, providerUserId, byEmail.rows[0].account_id, normalizedEmail, now]
          );
          return { id: byEmail.rows[0].id, display_name: byEmail.rows[0].display_name, account_id: byEmail.rows[0].account_id };
        }
      }

      const settings = await client.query('SELECT registration_enabled FROM site_settings WHERE id=1');
      if (!settings.rows[0].registration_enabled) throw new Error('Website đang tạm dừng đăng ký mới.');
      const accountId = randomUUID();
      try {
        await client.query(
          'INSERT INTO accounts(id, email, password_hash, created_at) VALUES($1,$2,$3,$4)',
          [accountId, normalizedEmail, null, now]
        );
      } catch (error) {
        if (error.code === '23505' && normalizedEmail) {
          const fallback = await client.query(
            `SELECT a.id AS account_id, p.id, p.display_name
             FROM accounts a JOIN players p ON p.account_id = a.id
             WHERE a.email = $1`,
            [normalizedEmail]
          );
          if (fallback.rows[0] && emailVerified) {
            await client.query(
              'INSERT INTO oauth_identities(provider, provider_user_id, account_id, email, created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
              [provider, providerUserId, fallback.rows[0].account_id, normalizedEmail, now]
            );
            return { id: fallback.rows[0].id, display_name: fallback.rows[0].display_name, account_id: fallback.rows[0].account_id };
          }
          throw new Error('Email này đã được đăng ký bằng mật khẩu. Hãy đăng nhập bằng email hoặc dùng tài khoản khác.');
        }
        throw error;
      }

      await client.query(
        'INSERT INTO oauth_identities(provider, provider_user_id, account_id, email, created_at) VALUES($1,$2,$3,$4,$5)',
        [provider, providerUserId, accountId, normalizedEmail, now]
      );

      if (guestPlayerId) {
        const guest = await client.query('SELECT id, account_id, display_name FROM players WHERE id = $1 FOR UPDATE', [guestPlayerId]);
        if (guest.rows[0] && !guest.rows[0].account_id) {
          const nextName = guest.rows[0].display_name === 'Bạn cờ' ? cleanName : guest.rows[0].display_name;
          await client.query('UPDATE players SET account_id = $1, display_name = $2 WHERE id = $3', [accountId, nextName, guestPlayerId]);
          return { id: guestPlayerId, display_name: nextName, account_id: accountId };
        }
      }

      const playerId = randomUUID();
      await client.query(
        'INSERT INTO players(id, account_id, display_name, created_at) VALUES($1,$2,$3,$4)',
        [playerId, accountId, cleanName, now]
      );
      return { id: playerId, display_name: cleanName, account_id: accountId };
    });
  }

  async function exchangeGoogle(code, callbackUrl) {
    const { id, secret } = creds('google');
    const tokenRes = await providerFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: callbackUrl, grant_type: 'authorization_code' }),
    });
    const tokenData = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenData?.access_token) throw new Error('Không xác thực được với Google.');
    const userRes = await providerFetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await userRes.json().catch(() => null);
    if (!userRes.ok || !profile?.sub) throw new Error('Không lấy được thông tin tài khoản Google.');
    return {
      providerUserId: String(profile.sub),
      email: profile.email || null,
      emailVerified: Boolean(profile.email_verified),
      displayName: profile.name || profile.given_name || null,
    };
  }

  async function exchangeFacebook(code, callbackUrl) {
    const { id, secret } = creds('facebook');
    const tokenUrl = new URL(`https://graph.facebook.com/${facebookGraphVersion}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({ client_id: id, client_secret: secret, redirect_uri: callbackUrl, code }).toString();
    const tokenRes = await providerFetch(tokenUrl.toString());
    const tokenData = await tokenRes.json().catch(() => null);
    if (!tokenRes.ok || !tokenData?.access_token) throw new Error('Không xác thực được với Facebook.');
    const profileUrl = new URL(`https://graph.facebook.com/${facebookGraphVersion}/me`);
    profileUrl.search = new URLSearchParams({ fields: 'id,name,email', access_token: tokenData.access_token }).toString();
    const userRes = await providerFetch(profileUrl.toString());
    const profile = await userRes.json().catch(() => null);
    if (!userRes.ok || !profile?.id) throw new Error('Không lấy được thông tin tài khoản Facebook.');
    return {
      providerUserId: String(profile.id),
      email: profile.email || null,
      emailVerified: Boolean(profile.email),
      displayName: profile.name || null,
    };
  }

  async function start(provider, req, res) {
    const returnOrigin = safeReturnOrigin(req.query.returnTo || req.headers.origin);
    const { id, secret } = creds(provider);
    if (!id || !secret) {
      const label = provider === 'google' ? 'Google (Gmail)' : 'Facebook';
      const vars = provider === 'google' ? 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET' : 'FACEBOOK_APP_ID / FACEBOOK_APP_SECRET';
      return finishError(res, returnOrigin, `Đăng nhập ${label} chưa được cấu hình (${vars}).`);
    }
    const current = await sessionFor(db, req).catch(() => null);
    const nonce = randomBytes(16).toString('base64url');
    const state = signState({
      nonce,
      provider,
      guestPlayerId: current && !current.account_id ? current.id : null,
      returnTo: returnOrigin,
      exp: Date.now() + 10 * 60 * 1000,
    });
    res.cookie('sc_oauth_state', nonce, cookieOptions(secureCookies, 600000));
    const cb = redirectUri(req, provider);
    if (provider === 'google') {
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.search = new URLSearchParams({
        client_id: id,
        redirect_uri: cb,
        response_type: 'code',
        scope: 'openid email profile',
        prompt: 'select_account',
        state,
      }).toString();
      return res.redirect(authUrl.toString());
    }
    const fbUrl = new URL(`https://www.facebook.com/${facebookGraphVersion}/dialog/oauth`);
    fbUrl.search = new URLSearchParams({
      client_id: id,
      redirect_uri: cb,
      response_type: 'code',
      scope: 'email,public_profile',
      state,
    }).toString();
    return res.redirect(fbUrl.toString());
  }

  async function callback(provider, req, res, disconnectSession) {
    const parsed = verifyState(req.query.state);
    const fallbackOrigin = allowedOrigins[0] || 'http://127.0.0.1:5173';
    if (!parsed || parsed.provider !== provider) {
      return finishError(res, fallbackOrigin, 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.');
    }
    const returnOrigin = safeReturnOrigin(parsed.returnTo);
    if (req.query.error) {
      return finishError(res, returnOrigin, 'Bạn đã hủy đăng nhập.');
    }
    const cookieNonce = cookieValue(req, 'sc_oauth_state');
    if (!safeEqual(cookieNonce, parsed.nonce) || typeof req.query.code !== 'string' || !req.query.code) {
      return finishError(res, returnOrigin, 'Xác thực trạng thái đăng nhập thất bại. Vui lòng thử lại.');
    }
    try {
      const cb = redirectUri(req, provider);
      const profile = provider === 'google'
        ? await exchangeGoogle(req.query.code, cb)
        : await exchangeFacebook(req.query.code, cb);
      const previous = await sessionFor(db, req).catch(() => null);
      const player = await resolvePlayer({
        provider,
        ...profile,
        guestPlayerId: previous && !previous.account_id ? previous.id : parsed.guestPlayerId,
      });
      await issueSession(db, res, player.id, previous?.token_hash || null, secureCookies);
      if (previous?.token_hash) disconnectSession(previous.token_hash);
      res.clearCookie('sc_oauth_state', cookieOptions(secureCookies));
      return res.redirect(`${returnOrigin}/?auth=ok`);
    } catch (error) {
      return finishError(res, returnOrigin, error instanceof Error ? error.message : 'Đăng nhập thất bại.');
    }
  }

  return { providers, start, callback, safeReturnOrigin };
}
