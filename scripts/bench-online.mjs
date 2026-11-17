import {randomUUID} from 'node:crypto';
import {io} from 'socket.io-client';
import {createApplication} from '../src/app.js';
const app=await createApplication({database:{memory:true},disableRateLimits:true}),sockets=[];
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${app.server.address().port}`;
const client=()=>{let cookie='';return {get cookie(){return cookie;},async call(path,body){const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();if(!r.ok)throw Error(data.error);return data;}};};
try{
  const users=[client(),client()];for(const u of users)await u.call('/me');
  for(const u of users){const socket=io(origin,{transports:['websocket'],extraHeaders:{Cookie:u.cookie},reconnection:false});sockets.push(socket);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});}
  let room,index=0,ownerMark,lastPacket;const samples=[],packets=[];
  while(samples.length<80){
    if(!room||room.game.phase==='finished'){
      const created=await users[0].call('/rooms',{minutes:15,kind:'caro',side:'first'});room=created.room;ownerMark=room.me.mark;await users[1].call(`/rooms/${room.id}/join`,{token:created.token});room=(await users[0].call(`/rooms/${room.id}`)).room;
      for(const user of users){room=(await user.call(`/rooms/${room.id}/actions`,{actionId:randomUUID(),version:room.version,action:'ready'})).room;}index=0;
    }
    const actor=room.game.turn===ownerMark?0:1,cell=(index++*73)%225,body={actionId:randomUUID(),version:room.version,action:'move',cell},started=performance.now();
    const reply=await sockets[actor].timeout(5000).emitWithAck('room-action',{id:room.id,body});
    if(reply.error)throw Error(reply.error);samples.push(performance.now()-started);room=reply.room;lastPacket=reply;packets.push(Buffer.byteLength(JSON.stringify(reply)));
  }
  const full={room:(await users[0].call(`/rooms/${room.id}`)).room},sorted=samples.toSorted((a,b)=>a-b),percentile=p=>Number(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)].toFixed(2));
  console.log(JSON.stringify({environment:'loopback + embedded PostgreSQL (not production)',samples:samples.length,ackAfterSQL_ms:{p50:percentile(.5),p95:percentile(.95),max:percentile(1)},meanLivePacket_bytes:Math.round(packets.reduce((a,b)=>a+b,0)/packets.length),lastLivePacket_bytes:Buffer.byteLength(JSON.stringify(lastPacket)),lastFullSnapshot_bytes:Buffer.byteLength(JSON.stringify(full))},null,2));
}finally{for(const s of sockets)s.disconnect();await app.close();}
