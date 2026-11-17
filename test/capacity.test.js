import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createActionGate} from '../src/action-gate.js';
import {openDatabase} from '../src/database.js';
import {createGuest} from '../src/auth.js';
import {RoomService} from '../src/rooms.js';

test('Memory tests and benchmarks never inherit an external database URL',async()=>{
  const previous=process.env.DATABASE_URL;process.env.DATABASE_URL='postgresql://invalid-test-host:1/must-not-connect';
  let db;
  try{db=await openDatabase({memory:true});assert.match(db.kind,/embedded/);}
  finally{if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;if(db)await db.close();}
});

test('Action admission caps concurrent work, isolates players and releases on failure',async()=>{
  const gate=createActionGate({maximum:2,perPlayer:1});let releaseA,releaseB;
  const a=gate('a',()=>new Promise(resolve=>releaseA=resolve)),b=gate('b',()=>new Promise(resolve=>releaseB=resolve));
  await assert.rejects(gate('a',async()=>{}),e=>e.status===429);
  await assert.rejects(gate('c',async()=>{}),e=>e.status===503);
  releaseA();releaseB();await Promise.all([a,b]);
  await assert.rejects(gate('a',async()=>{throw Error('failed');}),/failed/);
  assert.equal(await gate('a',async()=>42),42);
});

test('Compact lists exclude replay arrays, retain party membership and leave full games intact',async()=>{
  const db=await openDatabase({memory:true}),rooms=new RoomService(db);
  try{
    const users=await Promise.all([createGuest(db),createGuest(db),createGuest(db)]);
    for(const kind of['caro','go','ludo','monopoly']){
      const created=await rooms.create(users[0],5,kind,'first',['ludo','monopoly'].includes(kind)?3:2);
      for(const user of users.slice(1,kind==='ludo'||kind==='monopoly'?3:2))await rooms.join(created.room.id,user,created.token);
      const compact=(await rooms.mine(users[0].id,true)).find(r=>r.id===created.room.id);
      assert.equal(compact.summary,true);assert.equal(compact.game.moves,undefined);assert.equal(compact.game.board,undefined);assert.equal(compact.game.moveCount,0);
      assert.ok(Array.isArray((await rooms.get(compact.id,users[0].id)).game.board));
      if(['ludo','monopoly'].includes(kind)){
        assert.ok((await rooms.mine(users[2].id,true)).some(r=>r.id===compact.id));
      }else{
        let room=await rooms.get(compact.id,users[0].id);
        const act=async(user,action)=>room=await rooms.act(room.id,user.id,{actionId:randomUUID(),version:room.version,action});
        await act(users[0],'ready');await act(users[1],'ready');await act(users[0],'resign');
        const saved=(await rooms.history(users[1].id,true)).find(r=>r.id===room.id);
        assert.equal(saved.game.moves,undefined);assert.equal(saved.game.phase,'finished');assert.ok(saved.game.result);
        assert.ok(Array.isArray((await rooms.match(room.game.id,users[1].id)).game.moves));
      }
    }
  }finally{rooms.close();await db.close();}
});

test('A normal room read does not take a write transaction',async()=>{
  const db=await openDatabase({memory:true}),rooms=new RoomService(db);
  try{
    const user=await createGuest(db),created=await rooms.create(user,5);
    const transaction=db.transaction;db.transaction=()=>{throw Error('Unexpected write transaction');};
    assert.equal((await rooms.get(created.room.id,user.id)).id,created.room.id);
    db.transaction=transaction;
  }finally{rooms.close();await db.close();}
});
