import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initialDiscs,reversiFlips,discLegal,fourLine} from '../src/disc-games.js';
import {createPractice,makePracticeMove,legalMoves,undoHumanTurn} from '../src/practice-engine.js';
import {chooseBotMove} from '../src/bot.js';

test('Reversi starts with four discs, black first, and only capturing moves are legal',()=>{
  const g=createPractice('reversi','B','medium',randomUUID());
  assert.equal(g.turn,'B');assert.equal(g.board.filter(Boolean).length,4);
  assert.deepEqual(legalMoves(g).map(m=>m.to),[19,26,37,44]);
  assert.throws(()=>makePracticeMove(g,{to:0}),/hợp lệ/);assert.throws(()=>makePracticeMove(g,{from:1,to:19}),/hợp lệ/);
  makePracticeMove(g,{to:19});assert.equal(g.board[27],'B');assert.equal(g.turn,'W');assert.deepEqual(g.moves[0].flips,[27]);
  const restored=undoHumanTurn(g);assert.deepEqual(restored.board,initialDiscs('reversi'));assert.equal(restored.moves.length,0);
});
test('Reversi flips every bracketed direction and does not wrap across an edge',()=>{
  const board=Array(64).fill(null),to=27;
  for(const dr of[-1,0,1])for(const dc of[-1,0,1])if(dr||dc){board[(3+dr)*8+3+dc]='W';board[(3+2*dr)*8+3+2*dc]='B';}
  assert.equal(reversiFlips(board,to,'B').length,8);
  const edge=Array(64).fill(null);edge[7]='W';edge[6]='B';assert.deepEqual(reversiFlips(edge,8,'B'),[]);
});
test('Reversi auto-passes forced turns and finishes by count even when board has empty squares',()=>{
  const g=createPractice('reversi','B','medium',randomUUID());
  g.board=Array(64).fill('B');g.board[0]=null;g.board[1]='W';g.board[56]=null;g.board[57]='W';g.board[27]=null;
  makePracticeMove(g,{to:0});assert.equal(g.phase,'playing');assert.equal(g.turn,'B');assert.equal(g.passed,'W');
  makePracticeMove(g,{to:56});assert.equal(g.phase,'finished');assert.equal(g.result.reason,'disc-count');assert.equal(g.result.winner,'B');assert.ok(g.board.includes(null));
});
test('Connect Four enforces gravity and rejects full columns; vertical and horizontal wins finish',()=>{
  for(const sequence of[[35,36,28,29,21,22,14],[35,28,36,29,37,30,38]]){
    const g=createPractice('connect4','R','medium',randomUUID());
    assert.equal(legalMoves(g).length,7);assert.throws(()=>makePracticeMove(g,{to:0}),/hợp lệ/);
    for(const to of sequence)makePracticeMove(g,{to});assert.equal(g.phase,'finished');assert.equal(g.result.winner,'R');assert.equal(g.result.reason,'four');
  }
  const board=Array(42).fill(null);for(let row=0;row<6;row++)board[row*7]='R';assert.equal(discLegal('connect4',board,'Y').some(m=>m.to%7===0),false);
});
test('Connect Four recognizes both diagonals without row wrap',()=>{
  for(const line of[[14,22,30,38],[20,26,32,38]]){const board=Array(42).fill(null);for(const i of line)board[i]='R';assert.equal(fourLine(board,line.at(-1)).length,4);}
  const board=Array(42).fill(null);for(const i of[5,6,7,8])board[i]='R';assert.deepEqual(fourLine(board,7),[]);
});
test('New bots always return legal moves and take immediate Connect Four wins',()=>{
  for(const kind of['reversi','connect4'])for(const difficulty of['easy','medium','hard']){
    const g=createPractice(kind,kind==='reversi'?'B':'R',difficulty,randomUUID());
    const move=chooseBotMove(g);assert.ok(legalMoves(g).some(m=>m.to===move.to));makePracticeMove(g,move);assert.equal(g.moves.length,1);
  }
  const g=createPractice('connect4','R','hard',randomUUID());for(const to of[35,41,36,34,37,27])makePracticeMove(g,{to});
  const move=chooseBotMove(g);assert.equal(move.to,38);makePracticeMove(g,move);assert.equal(g.result.winner,'R');
});
