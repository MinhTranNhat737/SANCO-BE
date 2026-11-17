import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newGame, winningLine, settleTimeout, applyAction, coordinate } from '../src/game.js';
const makeRoom = () => ({ owner: { id: 'a', mark: 'X', ready: true }, guest: { id: 'b', mark: 'O', ready: true }, duration: 1000, drawOffer: null, game: { ...newGame(1000, randomUUID()), phase: 'playing', turnStartedAt: 100 } });
test('Detects horizontal, vertical and both diagonal wins at board edges', () => {
  for (const line of [[0,1,2,3,4],[14,29,44,59,74],[0,16,32,48,64],[14,28,42,56,70],[210,211,212,213,214,215]]) {
    const board = Array(225).fill(null); line.forEach(i => board[i]='X'); assert.equal(winningLine(board, line.at(-1)).length, line.length);
  }
});
test('Rows never wrap and blocked ends do not prevent a freestyle win', () => {
  const board = Array(225).fill(null); [12,13,14,15,16].forEach(i => board[i]='X'); assert.deepEqual(winningLine(board,14),[]);
  const blocked = Array(225).fill(null); [16,17,18,19,20].forEach(i=>blocked[i]='O'); blocked[15]='X';blocked[21]='X';assert.equal(winningLine(blocked,18).length,5);
});
test('Timeout wins over a move at the exact deadline and records that deadline', () => {
  const room=makeRoom();assert.equal(settleTimeout(room,1099),false);assert.equal(settleTimeout(room,1100),true);assert.equal(room.game.result.reason,'timeout');assert.equal(room.game.result.winner,'O');assert.equal(room.game.result.at,1100);assert.throws(()=>applyAction(room,'a','move',{cell:0},1100),/kết thúc/);
});
test('Rejects wrong turn, forged player, occupied and out-of-range cells', () => {
  const room=makeRoom();assert.throws(()=>applyAction(room,'b','move',{cell:0},101),/lượt/);assert.throws(()=>applyAction(room,'c','move',{cell:0},101),/quyền/);assert.throws(()=>applyAction(room,'a','move',{cell:225},101),/hợp lệ/);applyAction(room,'a','move',{cell:0},150);assert.equal(room.game.remaining.X,950);assert.throws(()=>applyAction(room,'b','move',{cell:0},160),/đã có/);
});
test('Draw offers are declined by opponent move and accepted explicitly', () => {
  const room=makeRoom();applyAction(room,'b','draw',{},110);applyAction(room,'a','move',{cell:0},120);assert.equal(room.drawOffer,null);applyAction(room,'a','draw',{},130);applyAction(room,'b','draw',{},140);assert.equal(room.game.result.reason,'agreement');assert.equal(room.game.result.winner,null);
});
test('Rematch requires both players, preserves old round and swaps sides', () => {
  const room=makeRoom();applyAction(room,'a','resign',{},110);const old=structuredClone(room.game);applyAction(room,'a','rematch',{},120,randomUUID());assert.equal(room.game.id,old.id);const next=randomUUID();applyAction(room,'b','rematch',{},130,next);assert.equal(room.game.id,next);assert.equal(room.owner.mark,'O');assert.equal(room.guest.mark,'X');assert.equal(room.game.phase,'waiting');assert.equal(room.owner.ready,false);assert.equal(old.result.reason,'resign');
});
test('Coordinate names use 15 columns',()=>{assert.equal(coordinate(0),'A1');assert.equal(coordinate(224),'O15');});
