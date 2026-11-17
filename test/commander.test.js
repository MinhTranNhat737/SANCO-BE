import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPractice,legalMoves,makePracticeMove,undoHumanTurn} from '../src/practice-engine.js';
import {initialCommander,commanderMove,commanderLegal,ctlUnits} from '../src/commander.js';
import {chooseBotMove} from '../src/bot.js';
import {createApplication} from '../src/app.js';
const at=(y,x)=>(11-y)*11+x;
function position(pieces,turn='r'){
  const g=createPractice('commander','r','easy',randomUUID());g.board.fill(null);
  for(const [y,x,p]of pieces)g.board[at(y,x)]=p;
  g.turn=turn;return g;
}
const move=(from,to,slot=0,mode='move')=>({from:at(...from),to:at(...to),action:`ctl-${slot}-${mode}`});
const has=(g,m)=>legalMoves(g).some(v=>v.from===m.from&&v.to===m.to&&v.action===m.action);
const kings=[[0,10,'rK'],[11,9,'bK']];

test('Commander preset has 132 intersections, 38 units, all 11 types, and exact symmetric placement',()=>{
  const b=initialCommander();assert.equal(b.length,132);assert.equal(b.filter(Boolean).length,38);
  for(const side of['r','b']){const u=b.filter(v=>v?.[0]===side);assert.equal(u.length,19);assert.equal(new Set(u.map(p=>p[1])).size,11);assert.equal(u.filter(p=>p[1]==='H').length,2);}
  assert.equal(b[at(0,6)],'rK');assert.equal(b[at(11,6)],'bK');assert.equal(b[at(4,2)],'rH');
});

test('Movement ranges, immobile headquarters, blockers, and artillery capture over blockers are enforced',()=>{
  const g=position([...kings,[3,4,'rI'],[3,7,'rT'],[1,4,'rP'],[2,4,'rD'],[4,4,'bI'],[7,10,'bT'],[0,3,'rH']]);
  assert.ok(has(g,move([3,4],[3,5])));assert.ok(!has(g,move([3,4],[4,5])));
  assert.ok(has(g,move([3,7],[5,7])));assert.ok(!has(g,move([3,7],[6,7])));
  assert.ok(has(g,move([1,4],[4,4])));assert.ok(!has(g,move([1,4],[3,4])));
  assert.ok(!legalMoves(g).some(m=>m.from===at(0,3)));
  makePracticeMove(g,move([1,4],[4,4]));assert.equal(g.board[at(2,4)],'rD');assert.equal(g.board[at(4,4)],'rP');
});

test('Heavy units use river fords, may capture across deep water, and engineers ferry a heavy stack',()=>{
  const g=position([...kings,[5,4,'rA'],[5,5,'rM'],[5,8,'rE+rP'],[9,3,'bI']]);
  assert.ok(!has(g,move([5,4],[6,4])));assert.ok(has(g,move([5,5],[6,5])));
  g.board[at(6,4)]='bI';assert.ok(has(g,move([5,4],[6,4])));
  assert.ok(has(g,move([5,8],[6,8])));assert.ok(!has(g,move([5,8],[5,9])));
  makePracticeMove(g,move([5,8],[6,8]));assert.equal(g.board[at(6,8)],'rE+rP');assert.equal(g.board[at(5,8)],null);
  g.turn='r';assert.ok(has(g,move([6,8],[7,8],1)));makePracticeMove(g,move([6,8],[7,8],1));assert.equal(g.board[at(6,8)],'rE');assert.equal(g.board[at(7,8)],'rP');
});

test('Sea and coast terrain constrain ships, and ranged sea/land attacks leave the shooter in place',()=>{
  const g=position([...kings,[4,2,'rN'],[4,4,'bI'],[8,8,'bT'],[1,3,'rP'],[1,1,'bN']]);
  assert.ok(!has(g,move([4,2],[4,3])));assert.ok(has(g,move([4,2],[8,2])));assert.ok(has(g,move([4,2],[4,4],0,'fire')));
  makePracticeMove(g,move([4,2],[4,4],0,'fire'));assert.equal(g.board[at(4,2)],'rN');assert.equal(g.board[at(4,4)],null);
  g.turn='r';assert.ok(has(g,move([1,3],[1,1],0,'fire')));makePracticeMove(g,move([1,3],[1,1],0,'fire'));assert.equal(g.board[at(1,3)],'rP');assert.equal(g.board[at(1,1)],null);
});

test('Aircraft can bomb or land, must occupy air-to-air captures, and AA uses circular radii',()=>{
  const g=position([...kings,[3,4,'rF'],[6,4,'bI'],[3,7,'bF'],[7,8,'bA'],[1,3,'rI']]);
  assert.ok(has(g,move([3,4],[6,4],0,'bomb')));assert.ok(has(g,move([3,4],[6,4])));
  assert.ok(!has(g,move([3,4],[3,7],0,'bomb')));assert.ok(has(g,move([3,4],[3,7])));
  makePracticeMove(g,move([3,4],[6,4],0,'bomb'));assert.equal(g.board[at(3,4)],'rF');assert.equal(g.board[at(6,4)],null);
  const diagonal=position([...kings,[4,4,'rF'],[6,6,'bA'],[2,9,'rI'],[8,9,'bI']]);
  makePracticeMove(diagonal,move([4,4],[5,5]));assert.equal(diagonal.board[at(5,5)],'rF','Diagonal distance sqrt(2) is outside radius 1');
});

test('Protected targets exchange with aircraft, unrelated AA intercepts before the target, heroes bypass AA',()=>{
  const exchange=position([...kings,[3,4,'rF+rK'],[6,4,'bA'],[0,10,'rI'],[7,9,'bI']]);
  makePracticeMove(exchange,move([3,4],[6,4],0,'bomb'));assert.equal(exchange.board[at(3,4)],null);assert.equal(exchange.board[at(6,4)],null);
  assert.equal(exchange.result.winner,'b');assert.ok(exchange.commander.scores.b>=1040);
  const intercepted=position([...kings,[2,4,'rF'],[3,4,'bA'],[6,4,'bI'],[0,3,'rI']]);
  makePracticeMove(intercepted,move([2,4],[6,4],0,'bomb'));assert.equal(intercepted.board[at(6,4)],'bI');assert.equal(intercepted.board[at(2,4)],null);
  const stealth=position([...kings,[3,4,'rF*'],[6,4,'bM'],[0,3,'rI']]);
  makePracticeMove(stealth,move([3,4],[6,4],0,'bomb'));assert.equal(stealth.board[at(3,4)],'rF*');assert.equal(stealth.board[at(6,4)],null);
});

test('Boarding, whole-stack carrying, passenger departure, HQ shelter, and capacity are real state transitions',()=>{
  const g=position([...kings,[2,4,'rI'],[2,5,'rT'],[7,9,'bI'],[1,7,'rH']]);
  makePracticeMove(g,move([2,4],[2,5],0,'board'));assert.equal(g.board[at(2,5)],'rT+rI');
  g.turn='r';makePracticeMove(g,move([2,5],[4,5]));assert.equal(g.board[at(4,5)],'rT+rI');
  g.turn='r';makePracticeMove(g,move([4,5],[4,6],1));assert.equal(g.board[at(4,5)],'rT');assert.equal(g.board[at(4,6)],'rI');
  const full=position([...kings,[2,4,'rI'],[2,5,'rT+rD+rK'],[7,9,'bI']]);assert.ok(!has(full,move([2,4],[2,5],0,'board')));
  const hq=position([[1,6,'rK'],[1,7,'rH'],[3,7,'bP'],[11,3,'bK'],[0,10,'rI']]);
  makePracticeMove(hq,move([1,6],[1,7],0,'board'));assert.equal(hq.board[at(1,7)],'rH+rK');
  makePracticeMove(hq,move([3,7],[1,7]));assert.equal(hq.result.reason,'commander-captured');assert.equal(hq.result.winner,'b');
});

test('Combined orders deploy units in distinct directions atomically, and forged/overlapping orders do not mutate',()=>{
  const g=position([...kings,[3,5,'rT+rI+rD'],[8,3,'bI']]);
  const order={from:at(3,5),to:at(5,5),action:'ctl-combined',details:{orders:[{unit:0,to:at(5,5),mode:'move'},{unit:1,to:at(3,4),mode:'move'},{unit:2,to:at(4,6),mode:'move'}]}};
  const before=structuredClone(g);const bad=structuredClone(order);bad.details.orders[2].to=bad.details.orders[1].to;assert.equal(commanderMove(g,bad),null);assert.deepEqual(g,before);
  makePracticeMove(g,order);assert.equal(g.board[at(3,5)],null);assert.equal(g.board[at(5,5)],'rT');assert.equal(g.board[at(3,4)],'rI');assert.equal(g.board[at(4,6)],'rD');assert.equal(g.moves.length,1);assert.equal(g.turn,'b');
  const forged=structuredClone(g);assert.throws(()=>makePracticeMove(g,{from:-1,to:999,action:'ctl-0-move'}));assert.deepEqual(g,forged);
});

test('Hero award follows a commander escape; last guard and stealth use their extended movement',()=>{
  const g=position([[0,10,'rK'],[7,5,'bK'],[3,5,'rP'],[2,8,'rI'],[10,3,'bI'],[10,4,'bT']]);
  makePracticeMove(g,move([3,5],[4,5]));assert.equal(g.check,true);assert.equal(g.board[at(4,5)],'rP');
  makePracticeMove(g,move([7,5],[7,6]));assert.equal(g.board[at(4,5)],'rP*');assert.ok(has(g,move([4,5],[8,5])));
  const guard=position([...kings,[3,4,'rI'],[10,3,'bI'],[10,5,'bT']]);makePracticeMove(guard,move([3,4],[3,5]));assert.equal(guard.board[at(3,5)],'rI*');guard.turn='r';assert.ok(has(guard,move([3,5],[5,7])));
});

test('Commander cannot walk through controlled points; exposed commanders can be captured; total battle ends',()=>{
  const g=position([[0,4,'rK'],[8,10,'bK'],[3,3,'bT'],[0,9,'rI']]);assert.ok(!has(g,move([0,4],[5,4])));
  const facing=position([[0,5,'rK'],[9,5,'bK'],[0,9,'rI'],[11,9,'bI']]);assert.ok(has(facing,move([0,5],[9,5])));makePracticeMove(facing,move([0,5],[9,5]));assert.equal(facing.result.winner,'r');
});

test('Every bot difficulty yields an accepted command, and undo reconstructs commands and score',()=>{
  for(const difficulty of['easy','medium','hard']){
    const g=createPractice('commander','r',difficulty,randomUUID()),before=structuredClone(g);const m=chooseBotMove(g);assert.ok(has(g,m));makePracticeMove(g,m);const restored=undoHumanTurn(g);assert.deepEqual(restored.board,before.board);assert.deepEqual(restored.commander,before.commander);
  }
});

let app,origin;
before(async()=>{app=await createApplication({database:{memory:true},disableRateLimits:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${app.server.address().port}`;});
after(async()=>{await app.close();});
function client(){let cookie='';return {async call(path,body,status=200){const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const out=await r.json();assert.equal(r.status,status,JSON.stringify(out));return out;}};}
test('Commander rooms and worker bots work through authenticated HTTP, deduplication, replay and rematch',async()=>{
  const a=client(),b=client();await a.call('/me');await b.call('/me');let {room,token}=await a.call('/rooms',{kind:'commander',minutes:5,side:'first'},201);await b.call(`/rooms/${room.id}/join`,{token});room=(await a.call(`/rooms/${room.id}`)).room;
  for(const user of[a,b])room=(await user.call(`/rooms/${room.id}/actions`,{action:'ready',version:room.version,actionId:randomUUID()})).room;
  room=(await a.call(`/rooms/${room.id}`)).room;const m=room.game.legal[0],{action:command,...coords}=m,body={...coords,command,action:'move',version:room.version,actionId:randomUUID()};room=(await a.call(`/rooms/${room.id}/actions`,body)).room;
  assert.equal((await a.call(`/rooms/${room.id}/actions`,body)).room.game.moves.length,1);assert.deepEqual((await b.call(`/rooms/${room.id}`)).room.game.board,room.game.board);
  room=(await b.call(`/rooms/${room.id}/actions`,{action:'resign',version:room.version,actionId:randomUUID()})).room;assert.equal((await a.call(`/matches/${room.game.id}`)).room.game.board.length,132);
  for(const user of[a,b])room=(await user.call(`/rooms/${room.id}/actions`,{action:'rematch',version:room.version,actionId:randomUUID()})).room;
  assert.equal(room.game.board.filter(Boolean).length,38);assert.equal(room.game.phase,'waiting');
  let {game}=await a.call('/practice',{kind:'commander',difficulty:'easy',side:'second'},201);const deadline=Date.now()+6000;
  while(game.thinking&&Date.now()<deadline){await new Promise(r=>setTimeout(r,40));game=(await a.call(`/practice/${game.id}`)).game;}
  assert.equal(game.thinking,false);assert.equal(game.moves.length,1);assert.ok(game.legal.length);assert.ok(game.moves[0].action.startsWith('ctl-'));
});
