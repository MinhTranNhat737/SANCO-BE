import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import { Server } from 'socket.io';
import { openDatabase } from './database.js';
import { RoomService } from './rooms.js';
import { PracticeService } from './practice.js';
import { GameError } from './game.js';
import {seats} from './room-game.js';
import {liveState} from './wire.js';
import {createActionGate} from './action-gate.js';
import { credentials, createGuest, hashPassword, verifyPassword, sessionFor, issueSession, cookieOptions, userView, validName } from './auth.js';
import { createOAuthService } from './oauth.js';
import {playerRatings,leaderboard,myLeaderboardPosition,botRoster,RANKS,INITIAL_ELO,PLACEMENT_GAMES} from './ratings.js';
import {Matchmaking,matchPresets} from './matchmaking.js';
import {createTrafficGuard,concurrencyGuard} from './traffic-guard.js';
import proxyaddr from 'proxy-addr';
import { adminRouter, siteSettings } from './admin.js';

export async function createApplication(options = {}) {
  const db = options.db || await openDatabase(options.database);
  const app = express(), server = createServer(app);
  const allowedOrigins = (options.origins || process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
  const secureCookies = options.secureCookies ?? (process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production');
  const allowedOrigin = origin => !origin || allowedOrigins.includes(origin);
  const traffic=createTrafficGuard({disabled:options.disableRateLimits});
  const socketIp=req=>proxyaddr(req,app.get('trust proxy fn')||(()=>false));
  const oauth = createOAuthService({ db, allowedOrigins, secureCookies, ...(options.oauth || {}) });
  // Reconnect resynchronizes from SQL. Avoid retaining every room packet in RAM.
  const io = new Server(server, { maxHttpBufferSize: 16384, perMessageDeflate:false,cors: { origin: (origin, done) => done(null, allowedOrigin(origin)), credentials: true }, allowRequest: (req, done) => done(null, allowedOrigin(req.headers.origin)&&traffic.allow(`handshake:${socketIp(req)}`,120,60000).ok) });
  const online = id => (io.sockets.adapter.rooms.get(`player:${id}`)?.size || 0) > 0;
  const inactivityMs = Number.isFinite(options.inactivityMs) ? options.inactivityMs : Number(process.env.ROOM_INACTIVITY_MS || 5 * 60 * 1000);
  const rooms = new RoomService(db, room => {
    for (const seat of seats(room)) if(online(seat.id))io.to(`player:${seat.id}`).emit('room', liveState(rooms.view(room, seat.id)));
  }, online, {
    inactivityMs,
    onDelete(id, memberIds) {
      for (const playerId of memberIds) {
        if (online(playerId)) io.to(`player:${playerId}`).emit('room-closed', { id, reason: 'inactive', message: 'Bàn đã bị hủy và xóa do không hoạt động quá 5 phút.' });
      }
    }
  });
  const practice = new PracticeService(db, (game, actor) => io.to(`player:${actor}`).emit('practice', liveState(game)), {
    inactivityMs,
    onDelete(id, playerId, ranked) {
      if (online(playerId)) io.to(`player:${playerId}`).emit('practice-closed', { id, reason: 'inactive', message: ranked?'Ván rank không hoạt động quá 5 phút: bạn nhận thua và đã cập nhật Elo.':'Bàn đã bị hủy và xóa do không hoạt động quá 5 phút.' });
    }
  });
  const dummyHash = await hashPassword('timing-only-password-no-account');
  const matchmaking=new Matchmaking(db,rooms);
  const actionGate=createActionGate();
  const passwordGate=createActionGate({maximum:4,perPlayer:2});
  const passwordWork=(req,work)=>options.disableRateLimits?work():passwordGate(req.ip,work);
  const limits = new Map();
  const cleanup = setInterval(() => { const now = Date.now(); for (const [key, value] of limits) if (value.until < now) limits.delete(key); db.query('DELETE FROM sessions WHERE expires_at < $1', [now]).catch(() => {}); db.query('DELETE FROM rank_queue WHERE expires_at < $1 AND room_id IS NULL',[now-60_000]).catch(()=>{}); }, 60000);
  cleanup.unref();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Vary': 'Origin' });
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' });
    if (!allowedOrigin(origin)) return next(new GameError('Nguồn yêu cầu không được phép.', 403));
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) return next(new GameError('Yêu cầu cần dùng JSON.', 415));
    next();
  });
  app.use('/api',traffic.middleware('api',1200,60000));
  if(!options.disableRateLimits)app.use('/api',concurrencyGuard());
  // Bound concurrent password hashing across IPs as well as existing login limits.
  if(!options.disableRateLimits)app.use(['/api/auth/login','/api/auth/register'],concurrencyGuard({maximum:4,perIp:2}));
  app.use(express.json({ limit: '16kb' }));
  const rate = (kind, maximum, windowMs) => (req, res, next) => {
    if (options.disableRateLimits) return next();
    const key = `${kind}:${req.ip}`, now = Date.now();
    if(limits.size>=20000&&!limits.has(key))return next(new GameError('Máy chủ đang bận.',503));
    let bucket = limits.get(key);
    if (!bucket || bucket.until <= now) { bucket = { count: 0, until: now + windowMs }; limits.set(key, bucket); }
    if (++bucket.count > maximum) { res.set('Retry-After', String(Math.ceil((bucket.until - now) / 1000))); return next(new GameError('Bạn thao tác quá nhanh. Vui lòng thử lại sau.', 429)); }
    next();
  };
  const required = async (req, _res, next) => {
    try { req.user = await sessionFor(db, req); if (!req.user) throw new GameError('Phiên đã hết hạn. Vui lòng tải lại trang hoặc đăng nhập.', 401); next(); } catch (e) { next(e); }
  };
  const requireAccount = (req, _res, next) => {
    if (!req.user?.account_id) return next(new GameError('Bạn cần đăng nhập tài khoản (Email, Google hoặc Facebook) mới được tạo phòng.', 403));
    next();
  };
  const disconnectSession = hash => { if (hash) io.in(`session:${hash}`).disconnectSockets(true); };
  app.use('/api/admin', adminRouter({ db, required, rooms, io, online }));
  app.get('/api/site', async (_req, res) => res.json({ settings: await siteSettings(db) }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, database: db.kind }));
  app.get('/api/ready',async(_req,res)=>{try{await db.query('SELECT 1');res.json({ok:true});}catch{res.status(503).json({ok:false});}});
  app.get('/api/auth/providers', (_req, res) => res.json({ providers: oauth.providers() }));
  app.get('/api/auth/google', (req, res, next) => { oauth.start('google', req, res).catch(next); });
  app.get('/api/auth/google/callback', (req, res, next) => { oauth.callback('google', req, res, disconnectSession).catch(next); });
  app.get('/api/auth/facebook', (req, res, next) => { oauth.start('facebook', req, res).catch(next); });
  app.get('/api/auth/facebook/callback', (req, res, next) => { oauth.callback('facebook', req, res, disconnectSession).catch(next); });
  app.get('/api/me', rate('session', 60, 60000), async (req, res) => {
    let user = await sessionFor(db, req);
    if (!user) { user = await createGuest(db); await issueSession(db, res, user.id, null, secureCookies); }
    res.json({ user: userView(user), providers: oauth.providers(), settings: await siteSettings(db) });
  });
  app.patch('/api/me', required, rate('profile', 20, 60000), async (req, res) => {
    const name = validName(req.body.name);
    await db.query('UPDATE players SET display_name=$1 WHERE id=$2', [name, req.user.id]);
    res.json({ user: userView({ ...req.user, display_name: name }) });
  });
  app.post('/api/auth/register', required, rate('register', 8, 600000), async (req, res) => {
    if (!(await siteSettings(db)).registration_enabled) throw new GameError('Website đang tạm dừng đăng ký mới.', 403);
    if (req.user.account_id) throw new GameError('Bạn đã đăng nhập tài khoản.');
    const { email, password } = credentials(req.body), name = validName(req.body.name);
    const passwordHash = await passwordWork(req,()=>hashPassword(password));
    const id = randomUUID();
    try {
      await db.transaction(async client => {
        const { rows } = await client.query('SELECT account_id FROM players WHERE id=$1 FOR UPDATE', [req.user.id]);
        if (rows[0].account_id) throw new GameError('Phiên này đã có tài khoản.', 409);
        await client.query('INSERT INTO accounts(id,email,password_hash,created_at) VALUES($1,$2,$3,$4)', [id, email, passwordHash, Date.now()]);
        await client.query('UPDATE players SET account_id=$1,display_name=$2 WHERE id=$3', [id, name, req.user.id]);
      });
    } catch (e) { if (e.code === '23505') throw new GameError('Email đã được sử dụng. Hãy đăng nhập hoặc dùng email khác.', 409); throw e; }
    await issueSession(db, res, req.user.id, req.user.token_hash, secureCookies);
    disconnectSession(req.user.token_hash);
    res.status(201).json({ user: { id: req.user.id, name, email, account: true } });
  });
  app.post('/api/auth/login', rate('login', 20, 600000), async (req, res) => {
    const { email, password } = credentials(req.body, 1);
    const previous = await sessionFor(db, req);
    const { rows } = await db.query('SELECT a.password_hash, a.email, p.id, p.display_name, p.account_id, p.is_admin FROM accounts a JOIN players p ON p.account_id=a.id WHERE a.email=$1', [email]);
    const valid = await passwordWork(req,()=>verifyPassword(password, rows[0]?.password_hash || dummyHash));
    if (!rows[0] || !valid) throw new GameError('Email hoặc mật khẩu chưa đúng.', 401);
    if (previous && previous.id !== rows[0].id) {
      const active = await db.query("SELECT id FROM rooms WHERE (owner_id=$1 OR guest_id=$1) AND state->'game'->>'phase'='playing' LIMIT 1", [previous.id]);
      if (active.rows.length) throw new GameError('Hãy hoàn tất ván đang chơi trước khi đổi tài khoản.', 409);
    }
    await issueSession(db, res, rows[0].id, previous?.token_hash, secureCookies);
    disconnectSession(previous?.token_hash);
    res.json({ user: userView(rows[0]) });
  });
  app.post('/api/auth/logout', required, async (req, res) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [req.user.token_hash]);
    disconnectSession(req.user.token_hash);
    res.clearCookie('sc_session', cookieOptions(secureCookies));
    res.json({ ok: true });
  });
  app.get('/api/rooms', required, async (req, res) => res.json({ rooms: await rooms.mine(req.user.id,req.query.summary==='1') }));
  app.get('/api/ratings',required,async(req,res)=>res.json({ratings:await playerRatings(db,req.user.id,req.query.pool??'overall'),ranks:RANKS,initialElo:INITIAL_ELO,placementGames:PLACEMENT_GAMES}));
  app.get('/api/leaderboard/:kind',required,async(req,res)=>{
    const kind=req.params.kind,pool=req.query.pool??'overall';
    const [players,me]=await Promise.all([leaderboard(db,kind,pool,req.user.id),myLeaderboardPosition(db,req.user.id,kind,pool)]);
    res.json({players,me});
  });
  app.get('/api/matchmaking',required,async(req,res)=>res.json({presets:matchPresets,ticket:await matchmaking.status(req.user.id)}));
  app.post('/api/matchmaking',required,rate('matchmaking',240,60000),async(req,res)=>{
    const {action,kind,preset}=req.body??{};
    if (action==='search' && !(await siteSettings(db)).rooms_enabled) throw new GameError('Website đang tạm dừng tạo phòng mới.', 503);
    res.json({ticket:await matchmaking.update(req.user,action,action==='search'?{kind,preset}:undefined)});
  });
  app.get('/api/bots/:kind',required,async(req,res)=>res.json({bots:botRoster(req.params.kind)}));
  const newRoomsAllowed = async (_req, _res, next) => {
    try { if (!(await siteSettings(db)).rooms_enabled) throw new GameError('Website đang tạm dừng tạo phòng mới.', 503); next(); } catch (error) { next(error); }
  };
  app.post('/api/rooms', required, requireAccount, newRoomsAllowed, rate('create-room', 30, 3600000), async (req, res) => res.status(201).json(await rooms.create(req.user, req.body.minutes,req.body.kind,req.body.side,req.body.capacity,req.body.ranked,req.body.estateMode)));
  app.get('/api/rooms/:id', required, async (req, res) => res.json({ room: await rooms.get(req.params.id, req.user.id) }));
  app.post('/api/rooms/:id/join', required, rate('join', 40, 60000), async (req, res) => res.json({ room: await rooms.join(req.params.id, req.user, req.body.token) }));
  app.post('/api/rooms/:id/invite', required, rate('invite', 15, 60000), async (req, res) => res.json(await rooms.invite(req.params.id, req.user.id)));
  app.post('/api/rooms/:id/actions', required, rate('actions', 180, 60000), async (req, res) => res.json({ room: await actionGate(req.user.id,()=>rooms.act(req.params.id, req.user.id, req.body)) }));
  app.get('/api/history', required, async (req, res) => res.json({ matches: await rooms.history(req.user.id,req.query.summary==='1') }));
  app.get('/api/practice', required, async (req,res) => res.json({games:await practice.list(req.user.id)}));
  app.post('/api/practice', required, rate('practice-create',40,3600000), async (req,res) => res.status(201).json({game:await practice.create(req.user,req.body)}));
  app.get('/api/practice/:id', required, async (req,res) => res.json({game:await practice.get(req.params.id,req.user.id)}));
  app.post('/api/practice/:id/actions', required, rate('practice-actions',180,60000), async (req,res) => res.json({game:await actionGate(req.user.id,()=>practice.act(req.params.id,req.user.id,req.body))}));
  app.get('/api/matches/:id', required, async (req, res) => res.json({ room: await rooms.match(req.params.id, req.user.id) }));
  app.post('/api/reports', required, rate('reports', 8, 3600000), async (req, res) => {
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : '';
    if (body.length < 10 || body.length > 2000) throw new GameError('Góp ý cần từ 10 đến 2000 ký tự.');
    if (req.body.roomId) await rooms.get(req.body.roomId, req.user.id);
    await db.query('INSERT INTO reports(id,player_id,room_id,body,created_at) VALUES($1,$2,$3,$4,$5)', [randomUUID(), req.user.id, req.body.roomId || null, body, Date.now()]);
    res.status(201).json({ ok: true });
  });
  if(options.staticDirectory||process.env.SERVE_FRONTEND==='true'){
    const directory=options.staticDirectory||(process.env.FRONTEND_STATIC_DIR ? path.resolve(process.env.FRONTEND_STATIC_DIR) : fileURLToPath(new URL('../../fe/dist/',import.meta.url)));
    const nonPublicQueries=['room','replay','practice','game','auth','auth_error'];
    app.get('/',(req,res,next)=>{
      if(nonPublicQueries.some(key=>Object.hasOwn(req.query,key)))res.set('X-Robots-Tag','noindex');
      next();
    });
    app.get(['/admin','/admin/','/admin.html'], (_req,res) => { res.set('X-Robots-Tag','noindex, nofollow'); res.sendFile(path.join(directory,'admin.html')); });
    app.get('/index.html',(req,res)=>res.redirect(308,`/${req.originalUrl.slice(req.path.length)}`));
    app.get('/choi/:page.html',(req,res)=>res.redirect(308,`/choi/${encodeURIComponent(req.params.page)}`));
    app.get('/choi/:page',(req,res,next)=>{
      if(!req.path.endsWith('/'))return next();
      const query=req.originalUrl.slice(req.path.length);
      res.redirect(308,`/choi/${encodeURIComponent(req.params.page)}${query}`);
    });
    app.use(express.static(directory,{extensions:['html'],maxAge:'1h',setHeaders(res,file){
      const asset=file.includes(`${path.sep}assets${path.sep}`);
      res.setHeader('Cache-Control',asset?'public, max-age=31536000, immutable':file.endsWith('.html')?'no-cache':'public, max-age=3600');
    }}));
    app.get('/{*path}',(req,res,next)=>{
      if(/^\/(api|socket\.io)(\/|$)/.test(req.path))return next();
      res.status(404).sendFile(path.join(directory,'404.html'),error=>{if(error&&!res.headersSent)next();});
    });
  }
  app.use((_req, _res, next) => next(new GameError('Không tìm thấy API.', 404)));
  app.use((error, _req, res, _next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500);
    if (status === 500) console.error('API error:', error.message);
    res.status(status).json({ error: status === 500 ? 'Máy chủ gặp sự cố. Vui lòng thử lại.' : error.message });
  });
  io.use(async (socket, next) => {
    if(!traffic.allow(`socket-auth:${socketIp(socket.request)}`,120,60000).ok){const error=new Error('Bạn thao tác quá nhanh.');error.data={status:429};return next(error);}
    try { const user = await sessionFor(db, socket.request); if (!user) {const error=new Error('Phiên đã hết hạn.');error.data={status:401};return next(error);} socket.data.user = user; next(); } catch { next(new Error('Không kết nối được máy chủ.')); }
  });
  io.on('connection', socket => {
    const user = socket.data.user;
    socket.join(`player:${user.id}`); socket.join(`session:${user.token_hash}`);
    socket.use(([event],next)=>{
      if(!traffic.allow(`socket:${user.id}`,360,60000).ok)return next(new Error('Rate limited'));
      if(event==='watch-room'&&!traffic.allow(`watch:${user.id}`,60,60000).ok)return next(new Error('Rate limited'));
      next();
    });
    socket.on('error',()=>{});
    const expiry = setTimeout(() => socket.disconnect(true), Math.min(+user.expires_at - Date.now(), 2147483647)); expiry.unref();
    socket.on('net-ping',ack=>{if(typeof ack==='function')ack({serverNow:Date.now()});});
    for(const [event,service,key]of[['room-action',rooms,'room'],['practice-action',practice,'game']])socket.on(event,async(request,ack)=>{
      if(typeof ack!=='function')return;
      try{
        const bucketKey=`socket-action:${user.id}`,now=Date.now();let bucket=limits.get(bucketKey);
        if(!bucket||bucket.until<=now){bucket={count:0,until:now+60000};limits.set(bucketKey,bucket);}
        if(!options.disableRateLimits&&++bucket.count>180)throw new GameError('Bạn thao tác quá nhanh.',429);
        if(!request||typeof request.id!=='string'||!request.body||typeof request.body!=='object')throw new GameError('Yêu cầu không hợp lệ.');
        if(now>=+user.expires_at||!await sessionFor(db,socket.request))throw new GameError('Phiên đã hết hạn.',401);
        const result=await actionGate(user.id,()=>service.act(request.id,user.id,request.body));ack({[key]:liveState(result)});
      }catch(error){ack({error:error.status?error.message:'Máy chủ gặp sự cố.',status:error.status||500});}
    });
    socket.on('watch-room', async (id, ack) => {
      try {
        if (typeof id !== 'string' || !/^[A-F0-9]{8}$/.test(id)) return;
        if(Date.now()>=+user.expires_at||!await sessionFor(db,socket.request))throw new GameError('Phiên đã hết hạn.',401);
        const view=await rooms.get(id,user.id);
        socket.data.roomId = id;
        if (typeof ack === 'function') ack({ ok: true,room:view });
      } catch { if (typeof ack === 'function') ack({ error: 'Không có quyền vào phòng.' }); }
    });
    socket.on('disconnect', () => { clearTimeout(expiry); if (socket.data.roomId) rooms.read(socket.data.roomId).then(room => rooms.onChange(room)).catch(() => {}); });
  });
  await rooms.start();
  await practice.start();
  return { app, server, db, rooms, practice, io, async close() { rooms.close(); await practice.close(); clearInterval(cleanup); await new Promise(resolve => io.close(resolve)); if (server.listening) await new Promise(resolve => server.close(resolve)); await db.close(); } };
}
