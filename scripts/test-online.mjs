import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {io} from 'socket.io-client';
import {createApplication} from '../src/app.js';
import {KINDS} from '../src/practice-engine.js';

// A real, isolated on-disk database. Never writes test accounts to the app database.
const directory=await mkdtemp(path.join(os.tmpdir(),'sanco-online-'));
let app,origin;
const sockets=[],acks=[],deliveries=[],createdRooms=[];
async function start(){
  app=await createApplication({database:{url:null,directory},disableRateLimits:true,secureCookies:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${app.server.address().port}`;
}
function client(){
  let cookie='';
  return {mark:null,get cookie(){return cookie;},async call(route,body,expected=200){
    const response=await fetch(origin+'/api'+route,{signal:AbortSignal.timeout(10000),method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
  },async connect(){
    const socket=io(origin,{transports:['websocket'],extraHeaders:{Cookie:cookie},reconnection:false,timeout:5000});
    sockets.push(socket);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});this.socket=socket;
  }};
}
async function action(user,room,action,fields={}){
  return (await user.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action,...fields})).room;
}
function receive(socket,id,version){
  let listener,timer;
  const promise=new Promise((resolve,reject)=>{
    listener=packet=>{if(packet.id===id&&packet.version===version){clearTimeout(timer);socket.off('room',listener);resolve({packet,at:performance.now()});}};
    timer=setTimeout(()=>{socket.off('room',listener);reject(Error('Opponent did not receive move'));},5000);
    socket.on('room',listener);
  });
  return promise;
}
const percentile=(values,p)=>+values.toSorted((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)].toFixed(2);
const distribution=values=>({p50:percentile(values,.5),p95:percentile(values,.95),max:percentile(values,1)});
try{
  await start();
  const users=[client(),client()],credentials=users.map((_,i)=>({name:`Người thử ${i+1}`,email:`online-${randomUUID()}@example.test`,password:randomUUID()}));
  for(const [i,user] of users.entries()){
    await user.call('/me');user.identity=(await user.call('/auth/register',credentials[i],201)).user;
    assert.equal(user.identity.account,true);await user.connect();
  }
  const hashes=(await app.db.query('SELECT password_hash FROM accounts')).rows;
  assert.equal(hashes.length,2);assert.ok(hashes.every(row=>row.password_hash.startsWith('scrypt$')));
  await client().call('/auth/login',{...credentials[0],password:'incorrect-password'},401);
  await client().call('/auth/register',credentials[0],401);
  const duplicate=client();await duplicate.call('/me');await duplicate.call('/auth/register',credentials[0],409);
  let measured=0;
  for(const kind of KINDS){
    const created=await users[0].call('/rooms',{kind,minutes:15,side:'first',capacity:2},201);
    let room=created.room;users[0].mark=room.me.mark;
    room=(await users[1].call(`/rooms/${room.id}/join`,{token:created.token})).room;users[1].mark=room.me.mark;
    for(const user of users)room=await action(user,room,'ready');
    assert.equal(room.game.phase,'playing');
    for(let n=0;n<8&&room.game.phase==='playing';n++){
      const actor=users.find(user=>user.mark===room.game.turn),opponent=users.find(user=>user!==actor);
      room=(await actor.call(`/rooms/${room.id}`)).room;
      const legal=kind==='caro'?{cell:(n*73)%225}:room.game.legal.find(move=>move.to>=0)||room.game.legal[0];
      assert.ok(legal,`Legal move for ${kind}`);
      const {action:command,...fields}=legal;
      const body={actionId:randomUUID(),version:room.version,...fields,...(command?{command}:{}),action:'move'};
      const peer=receive(opponent.socket,room.id,room.version+1),started=performance.now();
      const [ack,delivered]=await Promise.all([actor.socket.timeout(5000).emitWithAck('room-action',{id:room.id,body}).then(reply=>({reply,at:performance.now()})),peer]);
      assert.ok(!ack.reply.error,JSON.stringify(ack.reply));
      acks.push(ack.at-started);deliveries.push(delivered.at-started);measured++;
      const saved=(await actor.call(`/rooms/${room.id}`)).room;
      assert.deepEqual(delivered.packet.game.board,saved.game.board);
      assert.equal(saved.game.moves.length,n+1);
      // Socket timeout / HTTP fallback must never create a duplicate move.
      const retried=(await actor.call(`/rooms/${room.id}/actions`,body)).room;
      assert.equal(retried.game.moves.length,n+1);assert.equal(retried.version,saved.version);room=saved;
    }
    createdRooms.push({id:room.id,board:room.game.board,moves:room.game.moves.length});
    // Reconnect must receive the entire persisted stream, not only the last delta.
    users[1].socket.disconnect();await users[1].connect();
    const restored=await users[1].socket.timeout(5000).emitWithAck('watch-room',room.id);
    assert.deepEqual(restored.room.game.board,room.game.board);assert.equal(restored.room.game.moves.length,room.game.moves.length);
    if(room.game.phase==='playing')room=await action(users[1],room,'resign');
  }
  for(const socket of sockets)socket.disconnect();await app.close();app=null;
  await start();
  for(const [i,old] of users.entries()){
    const device=client(),logged=await device.call('/auth/login',credentials[i]);
    assert.equal(logged.user.id,old.identity.id);
    for(const saved of createdRooms){const room=(await device.call(`/rooms/${saved.id}`)).room;assert.deepEqual(room.game.board,saved.board);assert.equal(room.game.moves.length,saved.moves);}
    await device.call('/auth/logout',{});await device.call('/rooms',undefined,401);
  }
  console.log(JSON.stringify({environment:'localhost, real HTTP + WebSocket, isolated persistent PGlite',accounts:2,rooms:createdRooms.length,gameKinds:KINDS,measuredMoves:measured,errors:0,ackAfterSQL_ms:distribution(acks),opponentReceived_ms:distribution(deliveries),checks:['registration','duplicate email','wrong password','password hashes','invitation','ready','all game kinds','SQL persistence','HTTP retry deduplication','socket reconnect','server restart','login restores rooms','logout revokes session']},null,2));
}finally{
  for(const socket of sockets)socket.disconnect();if(app)await app.close();
  const resolved=path.resolve(directory),prefix=path.join(os.tmpdir(),'sanco-online-');
  if(resolved.startsWith(prefix))await rm(resolved,{recursive:true,force:true});
}
