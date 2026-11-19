import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Chess } from 'chess.js';
import { NativeBotService, engineConfiguration } from '../src/native-engine.js';
import { createPractice, boardSide, chessBoard, legalMoves, makePracticeMove } from '../src/practice-engine.js';
import { createApplication } from '../src/app.js';

const config=engineConfiguration({...process.env,NATIVE_ENGINES:'true'});
assert.ok(config.engines.chess&&config.engines.xiangqi,'Run npm run engines:install before testing native engines.');
process.env.NATIVE_ENGINES='true';

test('Official engines produce varied legal play, preserve histories and solve a chess mate in one', {timeout:60000}, async()=>{
  const service=new NativeBotService(config);
  try {
    for(const kind of ['chess','xiangqi']) {
      const openings=new Set();
      for(let n=0;n<12;n++) {
        const game=createPractice(kind,boardSide(kind,false),'medium',`native-${kind}-${n}`);
        for(let ply=0;ply<4;ply++) {
          const result=await service.chooseMove(game);
          assert.ok(result);
          assert.ok(legalMoves(game).some(move=>move.from===result.move.from&&move.to===result.move.to&&move.promotion===result.move.promotion));
          assert.match(result.engine.name,kind==='chess'?/Stockfish 19/:/Fairy-Stockfish/);
          if(!ply)openings.add(`${result.move.from}:${result.move.to}`);
          makePracticeMove(game,result.move);
        }
      }
      assert.ok(openings.size>=2,`${kind} repeated the same opening in every game`);
      console.log(`${kind}: ${openings.size} distinct first moves in 12 games; 48 legal plies.`);
    }
    const mate=createPractice('chess','b','hard',randomUUID());
    const position=new Chess('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
    mate.fen=position.fen();mate.initialFen=mate.fen;mate.board=chessBoard(position);mate.initialBoard=[...mate.board];
    const result=await service.chooseMove(mate);makePracticeMove(mate,result.move);
    assert.equal(mate.result?.reason,'checkmate');
    const promotion=createPractice('chess','b','hard',randomUUID());
    const promoted=new Chess('7k/P7/6K1/8/8/8/8/8 w - - 0 1');
    promotion.fen=promoted.fen();promotion.initialFen=promotion.fen;promotion.board=chessBoard(promoted);promotion.initialBoard=[...promotion.board];
    const answer=await service.chooseMove(promotion);makePracticeMove(promotion,answer.move);
    assert.ok(['q','r'].includes(answer.move.promotion));
    assert.equal(promotion.result?.reason,'checkmate');
  }finally{await service.close();}
});

test('Real HTTP practice games use Stockfish and Fairy-Stockfish and survive undo', {timeout:30000}, async()=>{
  const app=await createApplication({database:{memory:true},disableRateLimits:true});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  let cookie='';
  const call=async(route,body)=>{
    const response=await fetch(`${base}/api${route}`,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    assert.ok(response.ok,`HTTP ${response.status} for ${route}`);return response.json();
  };
  try {
    await call('/me');
    for(const kind of ['chess','xiangqi']) {
      let {game}=await call('/practice',{kind,difficulty:'medium',side:'first'});
      await call(`/practice/${game.id}/actions`,{actionId:randomUUID(),version:game.version,action:'move',...game.legal[0]});
      for(let n=0;n<250;n++) {
        ({game}=await call(`/practice/${game.id}`));
        if(!game.thinking)break;
        await new Promise(resolve=>setTimeout(resolve,40));
      }
      assert.equal(game.moves.length,2);assert.equal(game.botEngine?.id,kind==='chess'?'stockfish':'fairy-stockfish');
      const undone=await call(`/practice/${game.id}/actions`,{actionId:randomUUID(),version:game.version,action:'undo'});
      assert.equal(undone.game.moves.length,0);
    }
  }finally{await app.close();}
});
