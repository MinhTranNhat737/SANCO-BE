import {test} from 'node:test';
import assert from 'node:assert/strict';
import {io} from 'socket.io-client';
import {createApplication} from '../src/app.js';

test('Real HTTP public-read budget rejects spam before SQL and unauthenticated sockets expose terminal status',async()=>{
  const app=await createApplication({database:{memory:true},secureCookies:false});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const socket=io(origin,{autoConnect:false,transports:['websocket'],reconnection:false});
  try{
    const rejected=new Promise(resolve=>socket.once('connect_error',resolve));socket.connect();
    assert.equal((await rejected).data.status,401);
    for(let n=0;n<1200;n++){const response=await fetch(origin+'/api/health');assert.equal(response.status,200);await response.arrayBuffer();}
    const blocked=await fetch(origin+'/api/ready');assert.equal(blocked.status,429);assert.ok(Number(blocked.headers.get('Retry-After'))>0);
  }finally{socket.disconnect();await app.close();}
});
