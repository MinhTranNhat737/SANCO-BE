import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../src/app.js';

function fakeOAuthFetch() {
  return async (url) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'google-access-token' }), { status: 200 });
    }
    if (u === 'https://openidconnect.googleapis.com/v1/userinfo') {
      return new Response(JSON.stringify({
        sub: 'google-user-123',
        email: 'Player@Gmail.com',
        email_verified: true,
        name: 'Minh Google',
      }), { status: 200 });
    }
    if (u.startsWith('https://graph.facebook.com/v20.0/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'fb-access-token' }), { status: 200 });
    }
    if (u.startsWith('https://graph.facebook.com/v20.0/me')) {
      return new Response(JSON.stringify({
        id: 'fb-user-999',
        name: 'Minh Facebook',
      }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
}

test('Only logged-in accounts can create rooms, and Google/Facebook OAuth preserves guest session and unlocks room creation', async () => {
  const app = await createApplication({
    database: { memory: true },
    disableRateLimits: true,
    origins: 'https://sanco.games,https://www.sanco.games',
    oauth: {
      fetchImpl: fakeOAuthFetch(),
      config: {
        stateSecret: 'test-oauth-secret-key',
        publicApiUrl: 'https://api.sanco.games',
        googleClientId: 'g-id',
        googleClientSecret: 'g-sec',
        facebookAppId: 'fb-id',
        facebookAppSecret: 'fb-sec',
      },
    },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;

  try {
    // 1. Guest receives providers metadata, cannot create a room (403)
    const meRes = await fetch(`${origin}/api/me`);
    const meJson = await meRes.json();
    assert.equal(meRes.status, 200);
    assert.equal(meJson.user.account, false);
    assert.deepEqual(meJson.providers, { google: true, facebook: true });
    let guestCookie = meRes.headers.get('set-cookie').split(';')[0];

    const blocked = await fetch(`${origin}/api/rooms`, {
      method: 'POST',
      headers: { Cookie: guestCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 5, kind: 'caro' }),
    });
    assert.equal(blocked.status, 403);

    // 2. Tampered OAuth state is rejected cleanly
    const badCallback = await fetch(`${origin}/api/auth/google/callback?code=abc&state=tampered`, { redirect: 'manual' });
    assert.equal(badCallback.status, 302);
    assert.match(badCallback.headers.get('location'), /^https:\/\/sanco\.games\/\?auth_error=/);

    // 3. Google OAuth start -> callback upgrades guest and allows creating a room
    const gStart = await fetch(`${origin}/api/auth/google?returnTo=${encodeURIComponent('https://www.sanco.games')}`, {
      headers: { Cookie: guestCookie },
      redirect: 'manual',
    });
    assert.equal(gStart.status, 302);
    const gAuthUrl = new URL(gStart.headers.get('location'));
    assert.equal(gAuthUrl.origin, 'https://accounts.google.com');
    assert.equal(gAuthUrl.searchParams.get('redirect_uri'), 'https://api.sanco.games/api/auth/google/callback');
    const stateCookie = gStart.headers.get('set-cookie').split(';')[0];
    const stateParam = gAuthUrl.searchParams.get('state');

    const gCb = await fetch(`${origin}/api/auth/google/callback?code=auth-code&state=${encodeURIComponent(stateParam)}`, {
      headers: { Cookie: `${guestCookie}; ${stateCookie}` },
      redirect: 'manual',
    });
    assert.equal(gCb.status, 302);
    assert.equal(gCb.headers.get('location'), 'https://www.sanco.games/?auth=ok');
    const gSessionCookie = gCb.headers.getSetCookie().find(c => c.startsWith('sc_session=')).split(';')[0];

    const afterGoogle = await (await fetch(`${origin}/api/me`, { headers: { Cookie: gSessionCookie } })).json();
    assert.equal(afterGoogle.user.id, meJson.user.id);
    assert.equal(afterGoogle.user.account, true);
    assert.equal(afterGoogle.user.email, 'player@gmail.com');
    assert.equal(afterGoogle.user.name, 'Minh Google');

    const createdRoom = await fetch(`${origin}/api/rooms`, {
      method: 'POST',
      headers: { Cookie: gSessionCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 5, kind: 'caro' }),
    });
    assert.equal(createdRoom.status, 201);

    // 4. Facebook OAuth works even when Facebook returns no email
    const fbStart = await fetch(`${origin}/api/auth/facebook`, { redirect: 'manual' });
    assert.equal(fbStart.status, 302);
    const fbAuthUrl = new URL(fbStart.headers.get('location'));
    assert.equal(fbAuthUrl.origin, 'https://www.facebook.com');
    const fbStateCookie = fbStart.headers.get('set-cookie').split(';')[0];

    const fbCb = await fetch(`${origin}/api/auth/facebook/callback?code=fb-code&state=${encodeURIComponent(fbAuthUrl.searchParams.get('state'))}`, {
      headers: { Cookie: fbStateCookie },
      redirect: 'manual',
    });
    assert.equal(fbCb.status, 302);
    assert.equal(fbCb.headers.get('location'), 'https://sanco.games/?auth=ok');
    const fbSessionCookie = fbCb.headers.getSetCookie().find(c => c.startsWith('sc_session=')).split(';')[0];

    const afterFb = await (await fetch(`${origin}/api/me`, { headers: { Cookie: fbSessionCookie } })).json();
    assert.equal(afterFb.user.account, true);
    assert.equal(afterFb.user.name, 'Minh Facebook');
    assert.equal(afterFb.user.email, null);

    const fbRoom = await fetch(`${origin}/api/rooms`, {
      method: 'POST',
      headers: { Cookie: fbSessionCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ minutes: 5, kind: 'chess' }),
    });
    assert.equal(fbRoom.status, 201);
  } finally {
    await app.close();
  }
});
