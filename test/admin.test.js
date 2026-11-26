import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';
import { createApplication } from '../src/app.js';
import { digest, secret, hashPassword, issueSession } from '../src/auth.js';

let app, origin, admin, member;
const password = 'test-admin-password-only';
async function client({ role = false, guest = false, email = `${randomUUID()}@example.test` } = {}) {
  const id = randomUUID(), account = guest ? null : randomUUID(), token = secret();
  if (account) await app.db.query('INSERT INTO accounts(id,email,password_hash,created_at) VALUES($1,$2,$3,$4)',[account,email,await hashPassword(password),Date.now()]);
  await app.db.query('INSERT INTO players(id,account_id,display_name,is_admin,created_at) VALUES($1,$2,$3,$4,$5)',[id,account,'Người thử',role,Date.now()]);
  await app.db.query('INSERT INTO sessions(token_hash,player_id,expires_at,created_at) VALUES($1,$2,$3,$4)',[digest(token),id,Date.now()+60000,Date.now()]);
  const cookie = `sc_session=${token}`;
  const call = async (path, body, method) => {
    const res = await fetch(origin+'/api'+path,{method:method||(body?'POST':'GET'),headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    return { status:res.status, body:await res.json() };
  };
  return { id,email,cookie,call };
}
before(async () => {
  app = await createApplication({ database:{ memory:true }, disableRateLimits:true,inactivityMs:0 });
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve)); origin = `http://127.0.0.1:${app.server.address().port}`;
  admin = await client({ role:true }); member = await client();
});
after(async () => { await app.close(); });

test('Every admin endpoint rejects guests, ordinary accounts and unauthenticated requests', async () => {
  const guest = await client({ guest:true });
  for (const [path,body,method] of [
    ['/admin/overview'], ['/admin/users'], ['/admin/reports'], ['/admin/rooms'], ['/admin/matches'], ['/admin/practice'], ['/admin/audit'], ['/admin/settings'],
    ['/admin/settings',{announcement:'',registration_enabled:true,rooms_enabled:true},'PATCH'],
    [`/admin/users/${member.id}`,{is_admin:true},'PATCH'], [`/admin/users/${member.id}/revoke-sessions`,{}],
    [`/admin/reports/${randomUUID()}`,{status:'resolved',admin_note:''},'PATCH'], ['/admin/rooms/ABCDEF12/close',{reason:'test reason'}],
  ]) {
    assert.equal((await guest.call(path,body,method)).status,403,path);
    assert.equal((await member.call(path,body,method)).status,403,path);
    const noSession = await fetch(origin+'/api'+path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    assert.equal(noSession.status,401,path);
  }
  assert.equal((await member.call('/me',{is_admin:true,admin:true,name:'Normal name'},'PATCH')).body.user.admin,false);
  assert.equal((await member.call('/admin/overview')).status,403);
});
test('Dashboard and bounded lists return real records without authentication secrets', async () => {
  const overview = await admin.call('/admin/overview'); assert.equal(overview.status,200); assert.ok(overview.body.stats.accounts>=2);
  for (const collection of ['users','rooms','matches','practice','reports','audit']) {
    const result = await admin.call(`/admin/${collection}?q=${encodeURIComponent("%'; DROP TABLE players; --")}`);
    assert.equal(result.status,200,JSON.stringify(result.body)); assert.ok(result.body.items.length<=20);
    const all = await admin.call(`/admin/${collection}`); assert.equal(all.status,200); assert.equal(all.body.page,1);
    const serialized = JSON.stringify(all.body); for (const name of ['password_hash','token_hash','inviteHash','provider_user_id']) assert.ok(!serialized.includes(name),name);
  }
  assert.equal((await admin.call('/admin/users?page=-1')).status,400);
  assert.equal((await admin.call('/admin/users?page=1.5')).status,400);
  assert.equal((await admin.call('/admin/reports?status=wrong')).status,400);
  const result = await admin.call(`/admin/users?q=${encodeURIComponent(member.email)}&status=account`);
  assert.equal(result.body.total,1); assert.equal(result.body.items[0].id,member.id);
});
test('Admin can grant/revoke roles; self removal, self suspension, guests and invalid updates are rejected', async () => {
  const target = await client(), guest = await client({ guest:true });
  assert.equal((await admin.call(`/admin/users/${admin.id}`,{is_admin:false},'PATCH')).status,409);
  assert.equal((await admin.call(`/admin/users/${admin.id}`,{suspended:true,is_admin:false,reason:'testing'},'PATCH')).status,409);
  assert.equal((await admin.call(`/admin/users/${guest.id}`,{is_admin:true},'PATCH')).status,400);
  assert.equal((await admin.call(`/admin/users/${target.id}`,{is_admin:'true'},'PATCH')).status,400);
  assert.equal((await admin.call('/admin/users/not-a-uuid',{name:'New name'},'PATCH')).status,400);
  assert.equal((await admin.call(`/admin/users/${target.id}`,{is_admin:true,name:'New name'},'PATCH')).status,200);
  assert.equal((await target.call('/me')).body.user.admin,true);
  assert.equal((await target.call('/admin/overview')).status,200);
  assert.equal((await admin.call(`/admin/users/${target.id}`,{is_admin:false},'PATCH')).status,200);
  assert.equal((await target.call('/admin/overview')).status,401);
  const db = await app.db.query('SELECT is_admin,display_name FROM players WHERE id=$1',[target.id]);
  assert.deepEqual(db.rows[0],{is_admin:false,display_name:'New name'});
});
test('Suspension revokes HTTP and socket sessions, prevents email/OAuth session issuance, and can be lifted', async () => {
  const target = await client();
  const socket = io(origin,{extraHeaders:{Cookie:target.cookie},transports:['websocket'],reconnection:false});
  await new Promise((resolve,reject) => { socket.once('connect',resolve); socket.once('connect_error',reject); });
  try {
    assert.equal((await admin.call(`/admin/users/${target.id}`,{suspended:true,reason:'test'},'PATCH')).status,400);
    const disconnected = new Promise(resolve => socket.once('disconnect',resolve));
    assert.equal((await admin.call(`/admin/users/${target.id}`,{suspended:true,reason:'Vi phạm quy định'},'PATCH')).status,200);
    await disconnected;
    assert.equal((await target.call('/rooms')).status,401);
    assert.equal((await target.call('/auth/login',{email:target.email,password})).status,403);
    await assert.rejects(issueSession(app.db,{cookie(){assert.fail('must not issue cookie');}},target.id,null,false),{status:403});
    assert.equal((await admin.call(`/admin/users/${target.id}`,{suspended:false},'PATCH')).status,200);
    assert.equal((await target.call('/auth/login',{email:target.email,password})).status,200);
  } finally { socket.disconnect(); }
});
test('Session revocation preserves the account and requires a fresh login', async () => {
  const target = await client();
  assert.equal((await admin.call(`/admin/users/${target.id}/revoke-sessions`,{})).status,200);
  assert.equal((await target.call('/rooms')).status,401);
  assert.equal((await target.call('/auth/login',{email:target.email,password})).status,200);
});
test('Reports support review states, notes, search and transactional audit records', async () => {
  await member.call('/reports',{body:'Góp ý kiểm thử quản trị'});
  const found = await admin.call('/admin/reports?status=open&q='+encodeURIComponent('kiểm thử'));
  assert.equal(found.status,200); const report = found.body.items[0]; assert.ok(report);
  assert.equal((await admin.call(`/admin/reports/${report.id}`,{status:'resolved',admin_note:'Đã kiểm tra'},'PATCH')).status,200);
  const updated = await admin.call('/admin/reports?status=resolved');
  assert.equal(updated.body.items.find(r=>r.id===report.id).admin_note,'Đã kiểm tra');
  const audit = await admin.call('/admin/audit?q='+report.id); assert.ok(audit.body.items.some(a=>a.action==='report.update'));
});
test('Room cancellation notifies all players, preserves finished matches and never settles Elo', async () => {
  const a = await client(), b = await client();
  const created = await a.call('/rooms',{kind:'caro',minutes:5,ranked:true}); const id = created.body.room.id;
  await b.call(`/rooms/${id}/join`,{token:created.body.token});
  let room = (await a.call(`/rooms/${id}`)).body.room;
  room = (await a.call(`/rooms/${id}/actions`,{action:'ready',version:room.version,actionId:randomUUID()})).body.room;
  room = (await b.call(`/rooms/${id}/actions`,{action:'ready',version:room.version,actionId:randomUUID()})).body.room;
  assert.equal(room.game.phase,'playing');
  const socket = io(origin,{extraHeaders:{Cookie:b.cookie},transports:['websocket'],reconnection:false});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  try {
    const notification = new Promise(resolve=>socket.once('room-closed',resolve));
    assert.equal((await admin.call(`/admin/rooms/${id}/close`,{reason:'Kiểm thử hủy phòng'})).status,200);
    assert.equal((await notification).reason,'admin');
    assert.equal((await a.call(`/rooms/${id}`)).status,404);
    assert.equal(app.rooms.timers.has(id),false);
    assert.equal((await app.db.query('SELECT count(*)::int AS n FROM rating_settlements WHERE game_id=$1',[room.game.id])).rows[0].n,0);
  } finally { socket.disconnect(); }
  const finished = (await a.call('/rooms',{kind:'caro',minutes:5})).body;
  await b.call(`/rooms/${finished.room.id}/join`,{token:finished.token});
  await app.db.transaction(async db=>{const r=await app.rooms.read(finished.room.id,db,true);r.game.phase='finished';r.game.result={winner:null,reason:'agreement',line:[],at:Date.now()};await app.rooms.persist(db,r);});
  assert.equal((await admin.call(`/admin/rooms/${finished.room.id}/close`,{reason:'Dọn phòng kết thúc'})).status,200);
  const history = await a.call('/history'); assert.ok(history.body.matches.some(m=>m.game.id===finished.room.game.id));
  assert.ok((await admin.call('/admin/matches')).body.items.some(m=>m.id===finished.room.game.id&&m.room_id===null));
});
test('Settings enforce registration/room gates, publish escaped text data, and record changes', async () => {
  const settings = {announcement:'<script>plain text only</script>',registration_enabled:false,rooms_enabled:false};
  try {
    assert.equal((await admin.call('/admin/settings',settings,'PATCH')).status,200);
    assert.equal((await member.call('/me')).body.settings.announcement,settings.announcement);
    const guest = await client({guest:true});
    assert.equal((await guest.call('/auth/register',{name:'New member',email:'new@example.test',password})).status,403);
    assert.equal((await member.call('/rooms',{kind:'chess',minutes:5})).status,503);
    assert.equal((await member.call('/matchmaking',{action:'search',kind:'chess',preset:'rapid5'})).status,503);
    assert.equal((await member.call('/auth/login',{email:member.email,password})).status,200);
    assert.equal((await admin.call('/admin/settings',{...settings,rooms_enabled:'false'},'PATCH')).status,400);
    assert.equal((await admin.call('/admin/settings',{...settings,announcement:'x'.repeat(1001)},'PATCH')).status,400);
  } finally { await admin.call('/admin/settings',{announcement:'',registration_enabled:true,rooms_enabled:true},'PATCH'); }
});

test('The production frontend server serves all admin entry URLs with noindex and protected APIs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),'sanco-admin-static-'));
  const previousServe = process.env.SERVE_FRONTEND, previousDirectory = process.env.FRONTEND_STATIC_DIR;
  let instance;
  try {
    await writeFile(path.join(directory,'admin.html'),'<title>Admin dashboard</title>');
    process.env.SERVE_FRONTEND='true'; process.env.FRONTEND_STATIC_DIR=directory;
    instance = await createApplication({database:{memory:true},disableRateLimits:true});
    await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
    const base = `http://127.0.0.1:${instance.server.address().port}`;
    for (const entry of ['/admin','/admin/','/admin.html']) {
      const response = await fetch(base+entry); assert.equal(response.status,200);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');assert.match(await response.text(),/Admin dashboard/);
    }
    assert.equal((await fetch(base+'/api/admin/overview')).status,401);
  } finally {
    if(previousServe===undefined)delete process.env.SERVE_FRONTEND;else process.env.SERVE_FRONTEND=previousServe;
    if(previousDirectory===undefined)delete process.env.FRONTEND_STATIC_DIR;else process.env.FRONTEND_STATIC_DIR=previousDirectory;
    if(instance)await instance.close();
    if(path.resolve(directory).startsWith(path.join(os.tmpdir(),'sanco-admin-static-')))await rm(directory,{recursive:true,force:true});
  }
});
