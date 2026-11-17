import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Chess} from 'chess.js';
import {createPractice,makePracticeMove,legalMoves,chessBoard,positionKey,undoHumanTurn,squareIndex} from '../src/practice-engine.js';
import {initialXiangqi,xLegal,xPseudo,xInCheck} from '../src/xiangqi.js';
import {chooseBotMove} from '../src/bot.js';
import {createApplication} from '../src/app.js';

const game=kind=>createPractice(kind,kind==='caro'?'X':kind==='chess'?'w':'r','medium',randomUUID());
function loadChess(fen){const g=game('chess');g.fen=fen;g.board=chessBoard(new Chess(fen));g.turn=new Chess(fen).turn();g.initialBoard=[...g.board];g.repetitions={[positionKey(g)]:1};return g;}
test('Chess starting moves and promotion choices are validated server-side',()=>{
  const g=game('chess');assert.equal(legalMoves(g).length,20);assert.throws(()=>makePracticeMove(g,{from:52,to:20}),/hợp lệ/);
  const promotion=loadChess('7k/P7/8/8/8/8/8/7K w - - 0 1');assert.equal(legalMoves(promotion).filter(m=>m.from===8&&m.to===0).length,4);assert.throws(()=>makePracticeMove(promotion,{from:8,to:0}),/hợp lệ/);makePracticeMove(promotion,{from:8,to:0,promotion:'n'});assert.equal(promotion.board[0],'wN');
});
test('Chess castling, en passant, mate and stalemate use engine rules',()=>{
  const castle=loadChess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');makePracticeMove(castle,{from:60,to:62});assert.equal(castle.board[61],'wR');assert.equal(castle.board[63],null);
  const ep=loadChess('7k/8/8/3pP3/8/8/8/7K w - d6 0 1');makePracticeMove(ep,{from:squareIndex('e5'),to:squareIndex('d6')});assert.equal(ep.board[squareIndex('d5')],null);assert.equal(ep.moves[0].captured,'bP');
  const mate=game('chess');for(const [from,to]of[['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']])makePracticeMove(mate,{from:squareIndex(from),to:squareIndex(to)});assert.equal(mate.result.reason,'checkmate');assert.equal(mate.result.winner,'b');
  const stale=loadChess('7k/5K2/6Q1/8/8/8/8/8 w - - 0 1');makePracticeMove(stale,{from:squareIndex('g6'),to:squareIndex('f5')});assert.equal(stale.result.reason,'stalemate');
});
test('Xiangqi initial setup contains 32 pieces and correct horse moves',()=>{
  const b=initialXiangqi();assert.equal(b.filter(Boolean).length,32);const knight=xLegal(b,'r').filter(m=>m.from===82).map(m=>m.to).sort((a,b)=>a-b);assert.deepEqual(knight,[63,65]);
});
test('Xiangqi cannon requires exactly one screen to capture; horse leg and elephant eye block',()=>{
  const b=Array(90).fill(null);b[85]='rK';b[4]='bK';b[40]='rP';b[64]='rC';b[19]='bR';assert.equal(xPseudo(b,64).some(m=>m.to===19),false);b[46]='rP';assert.equal(xPseudo(b,64).some(m=>m.to===19),true);b[37]='bP';assert.equal(xPseudo(b,64).some(m=>m.to===19),false);
  const n=Array(90).fill(null);n[40]='rN';n[31]='rP';assert.equal(xPseudo(n,40).some(m=>m.to===21||m.to===23),false);
  const e=Array(90).fill(null);e[83]='rB';e[75]='rP';assert.equal(xPseudo(e,83).some(m=>m.to===67),false);assert.equal(xPseudo(e,83).some(m=>m.to===63),true);
});
test('Xiangqi forbids exposing facing generals and restricts pawn/king/palace movement',()=>{
  const b=Array(90).fill(null);b[85]='rK';b[4]='bK';b[49]='rR';assert.equal(xLegal(b,'r').some(m=>m.from===49&&m.to===48),false);assert.equal(xInCheck(b,'r'),false);b[49]=null;assert.equal(xInCheck(b,'r'),true);
  const p=Array(90).fill(null);p[58]='rP';assert.deepEqual(xPseudo(p,58).map(m=>m.to),[49]);p[58]=null;p[40]='rP';assert.deepEqual(xPseudo(p,40).map(m=>m.to).sort((a,b)=>a-b),[31,39,41]);p[84]='rK';assert.equal(xPseudo(p,84).some(m=>m.to===83),false);
});
test('Caro bot wins immediately and blocks immediate opponent wins',()=>{
  for(const mark of ['X','O']){const g=game('caro');for(const i of [0,1,2,3])g.board[i]=mark;g.moves=[{side:'X'}];const move=chooseBotMove(g);assert.equal(move.to,4);}
});
test('Xiangqi checkmate and stalemate both lose for the side with no legal move',()=>{
  for(const mate of [true,false]){const g=game('xiangqi');g.board=Array(90).fill(null);g.board[85]='rK';g.board[4]='bK';g.board[49]='rP';g.board[12]='rR';g.board[mate?2:23]='rR';g.repetitions={};makePracticeMove(g,{from:mate?2:23,to:mate?3:14});assert.equal(g.phase,'finished');assert.equal(g.result.winner,'r');assert.equal(g.result.reason,mate?'checkmate':'no-moves');}
});
test('All three bots return legal moves and practice undo removes the last human turn',()=>{
  for(const kind of ['caro','chess','xiangqi']){const g=game(kind);g.difficulty='easy';const first=chooseBotMove(g);assert.ok(legalMoves(g).some(m=>m.from===first.from&&m.to===first.to));makePracticeMove(g,first);const second=chooseBotMove(g);makePracticeMove(g,second);const restored=undoHumanTurn(g);assert.equal(restored.moves.length,0);assert.deepEqual(restored.board,restored.initialBoard);}
});

let app,origin;
before(async()=>{app=await createApplication({database:{memory:true},disableRateLimits:true});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${app.server.address().port}`;});
after(async()=>{await app.close();});
async function client(){let cookie='';return async(path,body)=>{const r=await fetch(origin+'/api'+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,body:await r.json()};};}
async function waitHuman(call,id){for(let n=0;n<100;n++){const out=await call('/practice/'+id);if(!out.body.game.thinking)return out.body.game;await new Promise(resolve=>setTimeout(resolve,40));}throw new Error('Bot did not complete');}
test('Practice APIs enforce ownership, persist bot moves, deduplicate and support undo/reload',async()=>{
  const a=await client(),b=await client();await a('/me');await b('/me');
  for(const kind of ['caro','chess','xiangqi']){
    const out=await a('/practice',{kind,difficulty:'easy',side:'first'});assert.equal(out.status,201);let g=out.body.game;
    assert.equal((await b('/practice/'+g.id)).status,404);
    const move=g.legal[0],body={actionId:randomUUID(),version:g.version,action:'move',...move};
    const moved=await a(`/practice/${g.id}/actions`,body);assert.equal(moved.status,200);assert.equal(moved.body.game.moves.length,1);
    assert.equal((await a(`/practice/${g.id}/actions`,body)).status,200);
    g=await waitHuman(a,g.id);assert.equal(g.moves.length,2);assert.equal(g.turn,g.humanSide);
    const undo=await a(`/practice/${g.id}/actions`,{actionId:randomUUID(),version:g.version,action:'undo'});assert.equal(undo.status,200);assert.equal(undo.body.game.moves.length,0);
    const saved=await a('/practice/'+g.id);assert.deepEqual(saved.body.game.board,saved.body.game.initialBoard);
  }
});
test('Bot moves first when second side is selected, and resignation prevents more bot moves',async()=>{
  const a=await client();await a('/me');const out=await a('/practice',{kind:'chess',difficulty:'easy',side:'second'});assert.equal(out.body.game.thinking,true);
  let g=await waitHuman(a,out.body.game.id);assert.equal(g.moves.length,1);assert.equal(g.turn,'b');
  const resigned=await a(`/practice/${g.id}/actions`,{actionId:randomUUID(),version:g.version,action:'resign'});assert.equal(resigned.body.game.phase,'finished');assert.equal(resigned.body.game.result.winner,'w');
});
test('Node watch dependency notifications are ignored while waiting for a bot move',async()=>{
  const previous=process.env.WATCH_REPORT_DEPENDENCIES;
  process.env.WATCH_REPORT_DEPENDENCIES='1';
  try{const a=await client();await a('/me');let g=(await a('/practice',{kind:'caro',difficulty:'easy',side:'first'})).body.game;g=(await a(`/practice/${g.id}/actions`,{actionId:randomUUID(),version:g.version,action:'move',...g.legal[0]})).body.game;const answer=await waitHuman(a,g.id);assert.equal(answer.moves.length,2);assert.equal(answer.turn,answer.humanSide);}
  finally{if(previous===undefined)delete process.env.WATCH_REPORT_DEPENDENCIES;else process.env.WATCH_REPORT_DEPENDENCIES=previous;}
});
test('Undo during bot computation followed by another move still schedules the replacement bot turn',async()=>{
  const a=await client();await a('/me');let g=(await a('/practice',{kind:'chess',difficulty:'hard',side:'first'})).body.game;
  const moved=await a(`/practice/${g.id}/actions`,{actionId:randomUUID(),version:g.version,action:'move',...g.legal[0]});g=moved.body.game;
  const undone=await a(`/practice/${g.id}/actions`,{actionId:randomUUID(),version:g.version,action:'undo'});assert.equal(undone.status,200);g=undone.body.game;
  g=(await a(`/practice/${g.id}/actions`,{actionId:randomUUID(),version:g.version,action:'move',...g.legal.at(-1)})).body.game;
  // Read storage directly: unlike the GET API, this does not enqueue a bot.
  for(let n=0;n<100;n++){const saved=await app.practice.read(g.id);if(saved.state.moves.length===2){assert.equal(saved.state.turn,saved.state.humanSide);return;}await new Promise(resolve=>setTimeout(resolve,40));}
  assert.fail('Replacement bot task was not scheduled');
});
