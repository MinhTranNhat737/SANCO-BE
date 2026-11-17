import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ABSTRACT_KINDS,abstractLegal,abstractMove,ganhNeighbors} from '../src/abstract-games.js';
import {createPractice,makePracticeMove,legalMoves,boardSide,undoHumanTurn} from '../src/practice-engine.js';
import {chooseBotMove} from '../src/bot.js';
import {createApplication} from '../src/app.js';
const fresh=kind=>createPractice(kind,boardSide(kind),'easy',randomUUID());
function position(kind,pieces,turn=boardSide(kind)){const g=fresh(kind);g.board.fill(null);for(const [i,side]of Object.entries(pieces))g.board[+i]=side;g.turn=turn;return g;}

test('Ataxx clones, jumps, converts all touching enemies, and rejects forged moves atomically',()=>{
  const g=position('ataxx',{0:'B',9:'W',48:'W'});
  const out=abstractMove(g,{from:0,to:8});assert.deepEqual(out.flips,[9]);assert.equal(g.board[0],'B');assert.equal(g.board[8],'B');assert.equal(g.board[9],'B');
  const jump=position('ataxx',{0:'B',48:'W'});abstractMove(jump,{from:0,to:16});assert.equal(jump.board[0],null);assert.equal(jump.board[16],'B');
  const before=structuredClone(jump);assert.equal(abstractMove(jump,{from:48,to:0}),null);assert.deepEqual(jump,before);
  const win=position('ataxx',{0:'B',9:'W'});assert.equal(abstractMove(win,{from:0,to:8}).result.winner,'B');
});
test('Breakthrough advances one step, captures diagonally only, and wins on the home rank',()=>{
  const g=position('breakthrough',{18:'W',10:'B',9:'B',63:'B'});
  assert.ok(!abstractLegal(g).some(m=>m.from===18&&m.to===10));assert.ok(abstractLegal(g).some(m=>m.from===18&&m.to===9));assert.ok(!abstractLegal(g).some(m=>m.to===34));
  makePracticeMove(g,{from:18,to:9});assert.equal(g.board[9],'W');assert.equal(g.moves[0].captured,'B');
  const win=position('breakthrough',{8:'W',63:'B'});makePracticeMove(win,{from:8,to:0});assert.equal(win.result.winner,'W');assert.equal(win.result.reason,'breakthrough');
});
test('Lines of Action counts the entire line, jumps allies but not enemies, and recognizes a connected group',()=>{
  const g=position('loa',{0:'B',2:'B',5:'W'});assert.ok(abstractLegal(g).some(m=>m.from===0&&m.to===3));assert.ok(!abstractLegal(g).some(m=>m.from===0&&m.to===4));
  g.board[1]='W';assert.ok(!abstractLegal(g).some(m=>m.from===0&&m.to===4));
  const win=position('loa',{0:'B',18:'B',63:'W'});const out=abstractMove(win,{from:0,to:27});assert.equal(out.result.winner,'B');assert.equal(out.result.reason,'connected');
});
test('Isolation permanently blocks the vacated square and cannot cross blocked cells or the opponent',()=>{
  const g=fresh('isolation');makePracticeMove(g,{from:0,to:9});assert.equal(g.board[0],'#');assert.ok(!legalMoves(g).some(m=>m.to===0));
  makePracticeMove(g,{from:63,to:54});assert.equal(g.board[63],'#');assert.ok(!legalMoves(g).some(m=>m.to===0||m.to===54||m.to===63));
  const end=fresh('isolation');end.board.fill('#');end.board[0]='B';end.board[1]=null;end.board[63]='W';makePracticeMove(end,{from:0,to:1});assert.equal(end.result.winner,'B');
});
test('Co ganh follows printed diagonals, converts symmetric pairs and surrounded groups, and enforces mo',()=>{
  assert.ok(ganhNeighbors(0).includes(6));assert.ok(!ganhNeighbors(1).includes(5));
  const g=position('coganh',{7:'B',11:'W',13:'W',24:'W'});const out=abstractMove(g,{from:7,to:12});assert.deepEqual(out.flips.sort((a,b)=>a-b),[11,13]);
  const surrounded=position('coganh',{0:'W',1:'B',5:'B',6:'B',7:'B',24:'W'});assert.ok(abstractMove(surrounded,{from:7,to:12}).flips.includes(0));
  const trap=position('coganh',{11:'B',16:'B',4:'B',10:'W',24:'W'});abstractMove(trap,{from:11,to:6});assert.equal(trap.forcedTo,11);assert.ok(abstractLegal(trap).every(m=>m.to===11));
  assert.equal(abstractMove(trap,{from:24,to:23}),null);const taken=abstractMove(trap,{from:10,to:11});assert.ok(taken.flips.includes(6)&&taken.flips.includes(16));assert.equal(trap.forcedTo,null);
});
test('All five bots return legal moves at every difficulty, and undo reconstructs the exact board',()=>{
  for(const kind of ABSTRACT_KINDS)for(const difficulty of['easy','medium','hard']){
    const g=fresh(kind);g.difficulty=difficulty;const initial=[...g.board];const move=chooseBotMove(g);assert.ok(legalMoves(g).some(m=>m.from===move.from&&m.to===move.to),kind);makePracticeMove(g,move);
    assert.deepEqual(undoHumanTurn(g).board,initial,kind);
  }
});

let app,origin;
before(async()=>{app=await createApplication({database:{memory:true},disableRateLimits:true});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${app.server.address().port}`;});
after(async()=>{await app.close();});
function client(){let cookie='';return {async call(route,body,status=200){const r=await fetch(origin+'/api'+route,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const out=await r.json();assert.equal(r.status,status,JSON.stringify(out));return out;}};}
test('New rooms persist legal play, deduplicate, save replays and rematch; practice workers reply through the real API',async()=>{
  for(const kind of ABSTRACT_KINDS){
    const a=client(),b=client();await a.call('/me');await b.call('/me');const created=await a.call('/rooms',{kind,minutes:5,side:'first'},201);let room=created.room;
    await b.call(`/rooms/${room.id}/join`,{token:created.token});room=(await a.call(`/rooms/${room.id}`)).room;
    for(const user of[a,b])room=(await user.call(`/rooms/${room.id}/actions`,{action:'ready',actionId:randomUUID(),version:room.version})).room;
    room=(await a.call(`/rooms/${room.id}`)).room;const request={action:'move',actionId:randomUUID(),version:room.version,...room.game.legal[0]};room=(await a.call(`/rooms/${room.id}/actions`,request)).room;
    assert.equal((await a.call(`/rooms/${room.id}/actions`,request)).room.game.moves.length,1);assert.deepEqual((await b.call(`/rooms/${room.id}`)).room.game.board,room.game.board);
    room=(await b.call(`/rooms/${room.id}/actions`,{action:'resign',actionId:randomUUID(),version:room.version})).room;
    assert.equal((await a.call(`/matches/${room.game.id}`)).room.game.moves.length,1);
    for(const user of[a,b])room=(await user.call(`/rooms/${room.id}/actions`,{action:'rematch',actionId:randomUUID(),version:room.version})).room;
    assert.equal(room.game.phase,'waiting');assert.equal(room.kind,kind);
    const data=await a.call('/practice',{kind,difficulty:'easy',side:'second'},201);let g=data.game;const deadline=Date.now()+5000;
    while(g.thinking&&Date.now()<deadline){await new Promise(r=>setTimeout(r,30));g=(await a.call(`/practice/${g.id}`)).game;}
    assert.equal(g.thinking,false,kind);assert.equal(g.moves.length,1,kind);assert.ok(g.legal.length,kind);
  }
});
