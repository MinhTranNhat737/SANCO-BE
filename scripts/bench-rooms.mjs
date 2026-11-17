import {randomUUID} from 'node:crypto';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {io} from 'socket.io-client';
import {createApplication} from '../src/app.js';
import {KINDS} from '../src/practice-engine.js';

const count=Number(process.env.BENCH_ROOMS||100),rounds=Number(process.env.BENCH_ROUNDS||10);
if(!Number.isInteger(count)||count<1||count>120||!Number.isInteger(rounds)||rounds<1||rounds>100)throw Error('Use 1..120 rooms and 1..100 rounds');
// Explicit opt-in only: never inherit the application's production DATABASE_URL.
const benchmarkURL=process.env.BENCH_DATABASE_URL;
const app=await createApplication({database:benchmarkURL?{url:benchmarkURL}:{memory:true},disableRateLimits:true}),sockets=[];
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${app.server.address().port}`;
const clients=()=>{let cookie='';return {mark:null,async call(path,body){const res=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];const out=await res.json();if(!res.ok)throw Error(`${res.status}: ${out.error}`);return out;},async connect(){const socket=io(origin,{transports:['websocket'],extraHeaders:{Cookie:cookie},reconnection:false});sockets.push(socket);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});this.socket=socket;}};};
const percentile=(values,p)=>{const sorted=values.toSorted((a,b)=>a-b);return +sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)].toFixed(2);};
const samples=[],reads=[],sizes=[],rooms=[],errors=[];const lag=monitorEventLoopDelay({resolution:10});
try{
  // Bounded setup avoids measuring a login/create-room flood as gameplay latency.
  for(let start=0;start<count;start+=10)await Promise.all(Array.from({length:Math.min(10,count-start)},async(_,offset)=>{
    const kind=KINDS[(start+offset)%KINDS.length],party=['ludo','monopoly'].includes(kind),users=Array.from({length:party?4:2},clients);
    for(const u of users){await u.call('/me');await u.connect();}
    const created=await users[0].call('/rooms',{minutes:15,kind,side:'first',capacity:users.length});let room=created.room;users[0].mark=room.me.mark;
    for(const u of users.slice(1)){const joined=await u.call(`/rooms/${room.id}/join`,{token:created.token});u.mark=joined.room.me.mark;room=joined.room;}
    for(const u of users)room=(await u.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action:'ready'})).room;
    rooms.push({room,users});
  }));
  lag.enable();const started=performance.now();
  for(let round=0;round<rounds;round++)await Promise.all(rooms.map(async entry=>{
    try{
      if(entry.room.game.phase!=='playing')return;
      const u=entry.users.find(u=>u.mark===entry.room.game.turn),readStart=performance.now();
      const room=(await u.call(`/rooms/${entry.room.id}`)).room;reads.push(performance.now()-readStart);
      const move=room.kind==='caro'?{cell:room.game.board.findIndex(v=>!v)}:room.game.legal.find(m=>m.to>=0)||room.game.legal[0];
      if(!move)throw Error('No legal action');
      const {action:command,...fields}=move,body={actionId:randomUUID(),version:room.version,...fields,...(command?{command}:{}),action:'move'},sent=performance.now();
      const reply=await u.socket.timeout(15000).emitWithAck('room-action',{id:room.id,body});
      if(reply.error)throw Error(`${reply.status}: ${reply.error}`);
      samples.push(performance.now()-sent);sizes.push(Buffer.byteLength(JSON.stringify(reply)));entry.room=reply.room;
    }catch(error){errors.push({room:entry.room.id,kind:entry.room.kind,message:error.message});}
  }));
  const elapsed=performance.now()-started;lag.disable();
  // Simultaneously load all compact lobby lists while rooms still exist.
  const listStarted=performance.now();await Promise.all(rooms.map(e=>e.users[0].call('/rooms?summary=1')));const listElapsed=performance.now()-listStarted;
  console.log(JSON.stringify({environment:benchmarkURL?'loopback + PostgreSQL':'loopback + embedded PostgreSQL (not production)',rooms:count,connections:sockets.length,gameKinds:KINDS,actions:samples.length,errors,elapsed_ms:+elapsed.toFixed(1),actions_per_second:+(samples.length*1000/elapsed).toFixed(1),ackAfterSQL_ms:{p50:percentile(samples,.5),p95:percentile(samples,.95),p99:percentile(samples,.99)},snapshotRead_ms:{p95:percentile(reads,.95)},eventLoopLag_p95_ms:+(lag.percentile(95)/1e6).toFixed(2),meanLivePacket_bytes:Math.round(sizes.reduce((a,b)=>a+b,0)/sizes.length),allLobbyLists_ms:+listElapsed.toFixed(1),heapUsed_MB:+(process.memoryUsage().heapUsed/1048576).toFixed(1)},null,2));
  if(errors.length)process.exitCode=1;
}finally{lag.disable();for(const socket of sockets)socket.disconnect();await app.close();}
