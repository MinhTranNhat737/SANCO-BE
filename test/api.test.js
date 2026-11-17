import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { createApplication } from '../src/app.js';

let app, origin;
before(async()=>{app=await createApplication({database:{memory:true},disableRateLimits:true});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${app.server.address().port}`;});
after(async()=>{await app.close();});
async function client(name='Người thử') {
  let cookie='';
  const call=async(path,body,method)=>{
    const response=await fetch(origin+'/api'+path,{method:method||(body?'POST':'GET'),headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
    return {status:response.status,body:await response.json(),headers:response.headers};
  };
  const initial=await call('/me');assert.equal(initial.status,200);await call('/me',{name},'PATCH');
  return {call,get cookie(){return cookie},user:initial.body.user};
}
async function pair() { const a=await client('An'),b=await client('Bình');const creation=await a.call('/rooms',{minutes:5});assert.equal(creation.status,201);let room=creation.body.room;await b.call(`/rooms/${room.id}/join`,{token:creation.body.token});room=(await a.call(`/rooms/${room.id}`)).body.room;return {a,b,room,token:creation.body.token}; }
async function act(player,room,action,cell){return player.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action,...(cell!==undefined?{cell}:{})});}
async function start(a,b,room){room=(await act(a,room,'ready')).body.room;room=(await act(b,room,'ready')).body.room;assert.equal(room.game.phase,'playing');return (await a.call(`/rooms/${room.id}`)).body.room;}

test('Private room requires invitation, cannot leak identity or grant third seat',async()=>{
  const {a,b,room}=await pair(),c=await client('Chi');
  const forbidden=await c.call(`/rooms/${room.id}`);assert.equal(forbidden.status,403);assert.equal(forbidden.body.room,undefined);
  assert.equal((await c.call(`/rooms/${room.id}/join`,{token:'wrong'})).status,403);
  const forged=await c.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action:'ready'});assert.equal(forged.status,403);
  assert.equal((await b.call(`/rooms/${room.id}/invite`,{})).status,403);
  assert.equal((await a.call(`/rooms/${room.id}`)).body.room.inviteHash,undefined);
});
test('Two simultaneous invitation claims allocate exactly one guest seat',async()=>{
  const a=await client('Chủ'),b=await client('Bạn một'),c=await client('Bạn hai');const created=(await a.call('/rooms',{minutes:3})).body;
  const out=await Promise.all([b.call(`/rooms/${created.room.id}/join`,{token:created.token}),c.call(`/rooms/${created.room.id}/join`,{token:created.token})]);assert.deepEqual(out.map(x=>x.status).sort(),[200,409]);
});
test('Revoked invitations stop new access; seated players retain their access',async()=>{
  const a=await client('An'),b=await client('Bình');const created=(await a.call('/rooms',{minutes:5})).body;const rotated=(await a.call(`/rooms/${created.room.id}/invite`,{})).body;
  assert.equal((await b.call(`/rooms/${created.room.id}/join`,{token:created.token})).status,403);
  assert.equal((await b.call(`/rooms/${created.room.id}/join`,{token:rotated.token})).status,200);
  await a.call(`/rooms/${created.room.id}/invite`,{});assert.equal((await b.call(`/rooms/${created.room.id}`)).status,200);
});
test('Complete game, idempotent retry, stale version, saved replay and rematch',async()=>{
  let {a,b,room}=await pair();room=await start(a,b,room);
  const x=room.me.mark==='X'?a:b,o=x===a?b:a;
  const body={actionId:randomUUID(),version:room.version,action:'move',cell:0};const first=await x.call(`/rooms/${room.id}/actions`,body);assert.equal(first.status,200);room=first.body.room;
  const retry=await x.call(`/rooms/${room.id}/actions`,body);assert.equal(retry.status,200);assert.equal(retry.body.room.game.moves.length,1);
  assert.equal((await x.call(`/rooms/${room.id}/actions`,{...body,cell:1})).status,409);
  assert.equal((await o.call(`/rooms/${room.id}/actions`,{...body,actionId:randomUUID(),cell:30})).status,409);
  for(const [player,cell] of [[o,30],[x,1],[o,31],[x,2],[o,32],[x,3],[o,33],[x,4]]){const response=await act(player,room,'move',cell);assert.equal(response.status,200,JSON.stringify(response.body));room=response.body.room;}
  assert.equal(room.game.result.winner,'X');assert.equal(room.game.moves.length,9);
  const id=room.game.id;
  assert.equal((await act(o,room,'move',40)).status,409);
  const history=await a.call('/history');assert.equal(history.body.matches[0].game.id,id);
  room=(await act(a,room,'rematch')).body.room;room=(await act(b,room,'rematch')).body.room;
  assert.notEqual(room.game.id,id);assert.equal(room.game.phase,'waiting');
  const replay=await a.call(`/matches/${id}`);assert.equal(replay.body.room.game.moves.length,9);assert.equal(replay.body.room.game.result.reason,'five');
  const outsider=await client('Khác');assert.equal((await outsider.call(`/matches/${id}`)).status,404);
});
test('Clock timeout is persisted with no player action and restored on restart',async()=>{
  let {a,b,room}=await pair();room=await start(a,b,room);
  await app.db.transaction(async db=>{const current=await app.rooms.read(room.id,db,true);current.game.remaining[current.game.turn]=30;current.game.turnStartedAt=Date.now();await app.rooms.persist(db,current);app.rooms.schedule(current);});
  await new Promise(resolve=>setTimeout(resolve,120));
  const saved=await app.rooms.read(room.id);assert.equal(saved.game.phase,'finished');assert.equal(saved.game.result.reason,'timeout');
  // Emulate downtime: no timer is installed for an already overdue persisted game.
  let second=await pair();let active=await start(second.a,second.b,second.room);
  await app.db.transaction(async db=>{const current=await app.rooms.read(active.id,db,true);current.game.turnStartedAt=Date.now()-current.game.remaining[current.game.turn]-1;await app.rooms.persist(db,current);clearTimeout(app.rooms.timers.get(active.id));});
  await app.rooms.start();assert.equal((await app.rooms.read(active.id)).game.phase,'finished');
});
test('Registration preserves guest player, password is hashed, login restores history and logout revokes',async()=>{
  const a=await client('Tài khoản');const before=a.user.id;const created=(await a.call('/rooms',{minutes:10})).body;
  const registered=await a.call('/auth/register',{name:'Minh',email:'minh@example.test',password:'a-long-test-password'});assert.equal(registered.status,201);assert.equal(registered.body.user.id,before);
  const {rows}=await app.db.query('SELECT password_hash FROM accounts WHERE email=$1',['minh@example.test']);assert.match(rows[0].password_hash,/^scrypt\$/);assert.equal(rows[0].password_hash.includes('a-long-test-password'),false);
  const device=await client('Máy khác');assert.equal((await device.call('/auth/login',{email:'minh@example.test',password:'wrong-password-long'})).status,401);
  const logged=await device.call('/auth/login',{email:'MINH@example.test',password:'a-long-test-password'});assert.equal(logged.status,200);assert.equal(logged.body.user.id,before);assert.equal((await device.call(`/rooms/${created.room.id}`)).status,200);
  const oldCookie=device.cookie;await device.call('/auth/logout',{});const revoked=await fetch(origin+'/api/rooms',{headers:{Cookie:oldCookie}});assert.equal(revoked.status,401);
});
test('Socket subscriptions require session and deliver authorized game updates',async()=>{
  const {a,b,room}=await pair();
  const socket=io(origin,{extraHeaders:{Cookie:b.cookie},transports:['websocket'],reconnection:false});
  try{
    await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
    const received=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('No room update')),3000);socket.on('room',next=>{if(next.id===room.id&&next.owner.ready){clearTimeout(timer);resolve(next);}});});
    socket.emit('watch-room',room.id);await act(a,room,'ready');const update=await received;assert.equal(update.me.role,'guest');assert.equal(update.inviteHash,undefined);
  }finally{socket.disconnect();}
});
test('Unexpected origins and non-JSON mutations are rejected',async()=>{
  const r=await fetch(origin+'/api/me',{headers:{Origin:'https://other.example'}});assert.equal(r.status,403);
  const form=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'email=a&password=b'});assert.equal(form.status,415);
});

test('Every game supports private creation, invitation, ready, legal move, replay, rematch and reload',async()=>{
  for(const kind of['caro','chess','xiangqi','reversi','connect4']){
    const a=await client('Chủ '+kind),b=await client('Bạn '+kind),c=await client('Ngoài phòng');
    const created=await a.call('/rooms',{minutes:5,kind,side:'first'});assert.equal(created.status,201,JSON.stringify(created.body));
    let room=created.body.room;assert.equal(room.kind,kind);
    assert.equal((await c.call(`/rooms/${room.id}`)).status,403);
    assert.equal((await b.call(`/rooms/${room.id}/join`,{token:created.body.token})).status,200);
    room=(await a.call(`/rooms/${room.id}`)).body.room;room=await start(a,b,room);
    const first=room.me.mark,move=kind==='caro'?{cell:112}:room.game.legal[0];assert.ok(move);
    const wrong=await b.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action:'move',...move});assert.equal(wrong.status,409);
    if(kind!=='caro'){
      const invalid=await a.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action:'move',from:null,to:-1});assert.equal(invalid.status,400);
    }
    const request={actionId:randomUUID(),version:room.version,action:'move',...move};
    const moved=await a.call(`/rooms/${room.id}/actions`,request);assert.equal(moved.status,200,JSON.stringify(moved.body));room=moved.body.room;
    const retry=await a.call(`/rooms/${room.id}/actions`,request);assert.equal(retry.status,200);assert.equal(retry.body.room.game.moves.length,1);
    assert.equal((await a.call(`/rooms/${room.id}/actions`,{...request,to:0,cell:0})).status,409);
    assert.equal((await b.call(`/rooms/${room.id}`)).body.room.game.moves.length,1);
    room=(await act(b,room,'resign')).body.room;assert.equal(room.game.result.winner,first);
    const saved=(await a.call('/history')).body.matches.find(m=>m.game.id===room.game.id);assert.equal(saved.kind,kind);assert.equal(saved.game.moves.length,1);
    const old=room.game.id;room=(await act(a,room,'rematch')).body.room;room=(await act(b,room,'rematch')).body.room;
    assert.notEqual(room.game.id,old);assert.equal(room.kind,kind);assert.equal(room.game.phase,'waiting');assert.equal(room.game.moves.length,0);
    const restored=(await a.call(`/rooms/${room.id}`)).body.room;assert.equal(restored.me.mark===first,false);assert.equal(restored.game.id,room.game.id);
  }
});

test('Room creation validates kind and side; second-side choice is honored',async()=>{
  const a=await client();assert.equal((await a.call('/rooms',{minutes:5,kind:'fake'})).status,400);assert.equal((await a.call('/rooms',{minutes:5,kind:'chess',side:'fake'})).status,400);
  const created=await a.call('/rooms',{minutes:10,kind:'chess',side:'second'});assert.equal(created.status,201);assert.equal(created.body.room.me.mark,'b');assert.equal(created.body.room.game.turn,'w');
});

test('New practice games persist worker bot replies and restore from SQL',async()=>{
  const a=await client('Tập cờ mới');
  for(const kind of['reversi','connect4']){
    const created=await a.call('/practice',{kind,difficulty:'easy',side:'second'});assert.equal(created.status,201,JSON.stringify(created.body));
    let g=created.body.game;const deadline=Date.now()+4000;
    while(g.thinking&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,35));g=(await a.call(`/practice/${g.id}`)).body.game;}
    assert.equal(g.thinking,false);assert.equal(g.moves.length,1);assert.ok(g.legal.length);
    const move=g.legal[0],reply=await a.call(`/practice/${g.id}/actions`,{actionId:randomUUID(),version:g.version,action:'move',...move});assert.equal(reply.status,200);
    const stored=(await app.db.query('SELECT state FROM practice_games WHERE id=$1',[g.id])).rows[0].state;
    assert.ok(stored.moves.length>=2);assert.equal(stored.kind,kind);
  }
});

test('Three-seat party rooms retain every seat, permission and history through rematch',async()=>{
  for(const kind of['ludo','monopoly']){
    const a=await client('Đỏ'),b=await client('Xanh'),c=await client('Vàng'),outside=await client('Ngoài');
    const created=(await a.call('/rooms',{minutes:5,kind,side:'first',capacity:3})).body;let room=created.room;
    await b.call(`/rooms/${room.id}/join`,{token:created.token});await c.call(`/rooms/${room.id}/join`,{token:created.token});
    assert.equal((await outside.call(`/rooms/${room.id}/join`,{token:created.token})).status,409);
    for(const player of[a,b,c]){room=(await player.call(`/rooms/${room.id}`)).body.room;room=(await act(player,room,'ready')).body.room;}
    assert.equal(room.game.phase,'playing');assert.equal(room.players.length,3);assert.ok(room.players.every(s=>s.ready));
    room=(await a.call(`/rooms/${room.id}`)).body.room;
    const body={actionId:randomUUID(),version:room.version,action:'move',command:'roll',from:null,to:-1,die:99};
    const rolled=await a.call(`/rooms/${room.id}/actions`,body);assert.equal(rolled.status,200,JSON.stringify(rolled.body));room=rolled.body.room;
    assert.ok(room.game.moves[0].die>=1&&room.game.moves[0].die<=6);
    assert.equal((await a.call(`/rooms/${room.id}/actions`,body)).body.room.game.moves.length,1);
    assert.equal((await c.call('/rooms')).body.rooms.some(r=>r.id===room.id),true);
    room=(await act(c,room,'resign')).body.room;assert.equal(room.game.phase,'playing');room=(await act(b,room,'resign')).body.room;assert.equal(room.game.phase,'finished');
    assert.equal((await c.call(`/matches/${room.game.id}`)).status,200);assert.equal((await outside.call(`/matches/${room.game.id}`)).status,404);
    const old=room.game.id;
    for(const player of[a,b,c]){room=(await player.call(`/rooms/${room.id}`)).body.room;room=(await act(player,room,'rematch')).body.room;}
    assert.notEqual(room.game.id,old);assert.equal(room.game.phase,'waiting');assert.ok(room.game.party.players.every(p=>p.active));assert.equal(new Set(room.players.map(s=>s.mark)).size,3);
  }
});

test('Go, draughts and tic-tac-toe room moves and new practice workers survive reload',async()=>{
  for(const kind of['go','checkers','tictactoe']){
    const a=await client('A'),b=await client('B');const created=(await a.call('/rooms',{minutes:5,kind,side:'first'})).body;await b.call(`/rooms/${created.room.id}/join`,{token:created.token});
    let room=(await a.call(`/rooms/${created.room.id}`)).body.room;room=await start(a,b,room);
    const moved=await a.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action:'move',...room.game.legal[0]});assert.equal(moved.status,200,JSON.stringify(moved.body));assert.equal((await b.call(`/rooms/${room.id}`)).body.room.game.moves.length,1);
  }
  const a=await client('Bot mới');
  for(const kind of['go','checkers','tictactoe','ludo','monopoly']){
    const created=await a.call('/practice',{kind,difficulty:'easy',side:'second'});assert.equal(created.status,201,JSON.stringify(created.body));let g=created.body.game;const deadline=Date.now()+6000;
    while(g.thinking&&Date.now()<deadline){await new Promise(r=>setTimeout(r,40));g=(await a.call(`/practice/${g.id}`)).body.game;}
    assert.equal(g.thinking,false,kind);assert.ok(g.moves.length>0,kind);assert.ok(g.legal.length,kind);
  }
});

test('Socket action ack, HTTP retry and reconnect preserve one authoritative move stream',async()=>{
  const a=await client('Socket A'),b=await client('Socket B'),c=await client('Outsider');const created=(await a.call('/rooms',{minutes:5,kind:'chess',side:'first'})).body;
  await b.call(`/rooms/${created.room.id}/join`,{token:created.token});let room=(await a.call(`/rooms/${created.room.id}`)).body.room;room=await start(a,b,room);
  const sockets=[a,b,c].map(player=>io(origin,{extraHeaders:{Cookie:player.cookie},transports:['websocket'],reconnectionDelay:60}));
  try{
    await Promise.all(sockets.map(s=>new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject);})));
    const watched=await sockets[0].timeout(3000).emitWithAck('watch-room',room.id);assert.equal(watched.room.game.moves.length,0);
    const body={actionId:randomUUID(),version:room.version,action:'move',from:52,to:36};
    const out=await sockets[0].timeout(3000).emitWithAck('room-action',{id:room.id,body});assert.equal(out.room.game.moveCount,1);assert.equal(out.room.game.moves,undefined);assert.equal(out.room.game.movesAppend.length,1);
    const retry=await a.call(`/rooms/${room.id}/actions`,body);assert.equal(retry.status,200);assert.equal(retry.body.room.game.moves.length,1);room=retry.body.room;
    const forged=await sockets[2].timeout(3000).emitWithAck('room-action',{id:room.id,body:{...body,actionId:randomUUID(),version:room.version}});assert.equal(forged.status,403);assert.equal(forged.room,undefined);
    const reconnected=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Reconnect timed out')),4000);sockets[0].once('connect',()=>{clearTimeout(timer);resolve();});});sockets[0].io.engine.close();
    const response=await b.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action:'move',from:12,to:28});assert.equal(response.status,200);await reconnected;
    const restored=await sockets[0].timeout(3000).emitWithAck('watch-room',room.id);assert.equal(restored.room.game.moves.length,2);assert.deepEqual(restored.room.game.board,response.body.room.game.board);
  }finally{for(const s of sockets)s.disconnect();}
});
test('Four-player room grants the fourth color and timeout eliminates only the current player',async()=>{
  const users=await Promise.all([client('Một'),client('Hai'),client('Ba'),client('Bốn')]);
  const created=(await users[0].call('/rooms',{minutes:5,kind:'ludo',side:'first',capacity:4})).body;
  for(const user of users.slice(1))assert.equal((await user.call(`/rooms/${created.room.id}/join`,{token:created.token})).status,200);
  let room;
  for(const user of users){room=(await user.call(`/rooms/${created.room.id}`)).body.room;room=(await act(user,room,'ready')).body.room;}
  assert.equal(room.game.phase,'playing');assert.equal(room.me.mark,'B');assert.equal(room.players.length,4);
  await app.db.transaction(async db=>{const saved=await app.rooms.read(room.id,db,true);saved.game.remaining[saved.game.turn]=1;saved.game.turnStartedAt=Date.now()-2;await app.rooms.persist(db,saved);});
  await app.rooms.expire(room.id);const restored=(await users[3].call(`/rooms/${room.id}`)).body.room;
  assert.equal(restored.game.phase,'playing');assert.equal(restored.game.party.players.filter(p=>p.active).length,3);assert.equal(restored.game.turn,'G');assert.equal(restored.game.remaining.R,0);
});

test('Vietnam gifts and consented loans persist, reject forged responses and deduplicate complete transaction details',async()=>{
  const a=await client('Việt'),b=await client('Nam'),created=(await a.call('/rooms',{minutes:60,kind:'monopoly',side:'first'})).body;
  await b.call(`/rooms/${created.room.id}/join`,{token:created.token});let room=(await a.call(`/rooms/${created.room.id}`)).body.room;
  room=(await act(a,room,'ready')).body.room;room=(await act(b,room,'ready')).body.room;
  const gift={actionId:randomUUID(),version:room.version,action:'move',from:null,to:-1,command:'gift',details:{partner:'G',amount:200}};
  const out=await a.call(`/rooms/${room.id}/actions`,gift);assert.equal(out.status,200);assert.deepEqual(out.body.room.game.party.players.map(p=>p.cash),[2800,3200]);room=out.body.room;
  assert.equal((await a.call(`/rooms/${room.id}/actions`,gift)).body.room.game.moves.length,1);
  assert.equal((await a.call(`/rooms/${room.id}/actions`,{...gift,details:{partner:'G',amount:201}})).status,409);
  const proposal={actionId:randomUUID(),version:room.version,action:'move',from:null,to:-1,command:'loan',details:{partner:'G',principal:500,interest:10,term:2}};
  room=(await a.call(`/rooms/${room.id}/actions`,proposal)).body.room;assert.equal(room.game.turn,'G');assert.equal(room.game.party.pending.principal,500);assert.equal(room.game.party.loans.length,0);
  assert.equal((await a.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action:'move',from:null,to:-1,command:'accept'})).status,409);
  const accepted=await b.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action:'move',from:null,to:-1,command:'accept'});assert.equal(accepted.status,200);
  const restored=(await a.call(`/rooms/${room.id}`)).body.room;assert.equal(restored.game.party.loans[0].total,550);assert.equal(restored.game.party.pending,null);assert.deepEqual(restored.game.party.players.map(p=>p.cash),[2300,3700]);assert.equal(restored.game.turn,'R');assert.equal(restored.game.moves.length,3);
});
