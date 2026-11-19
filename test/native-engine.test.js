import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NativeBotService, UciEngine, engineConfiguration, enginePosition, moveToUci, selectEngineCandidate, xiangqiFen } from '../src/native-engine.js';
import { boardSide, createPractice, legalMoves, makePracticeMove } from '../src/practice-engine.js';
import { openDatabase } from '../src/database.js';
import { createGuest } from '../src/auth.js';
import { PracticeService } from '../src/practice.js';

const fixture = fileURLToPath(new URL('./fixtures/uci-engine.mjs', import.meta.url));
const configuration = (mode = 'normal', log) => ({ path: process.execPath, args: [fixture, mode, ...(log ? [log] : [])], id: 'fixture-engine' });
const game = (kind = 'chess', id = 'test-engine') => createPractice(kind, boardSide(kind, false), 'medium', id);
const matches = (legal, move) => legal.some(candidate => candidate.from === move.from && candidate.to === move.to && candidate.promotion === move.promotion);

test('UCI positions preserve chess history, castling and promotions; Xiangqi uses ten-rank UCI coordinates', () => {
  const chess = game();
  for (const [from, to] of [[52,36],[12,28],[62,45]]) makePracticeMove(chess, {from,to});
  assert.match(enginePosition(chess), / moves e2e4 e7e5 g1f3$/);
  assert.equal(moveToUci('chess', {from:60,to:62}), 'e1g1');
  assert.equal(moveToUci('chess', {from:8,to:0,promotion:'n'}), 'a7a8n');
  const x = game('xiangqi');
  assert.equal(xiangqiFen(x.board), 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1');
  assert.equal(moveToUci('xiangqi', {from:1,to:20}), 'b10c8');
  makePracticeMove(x, {from:64,to:67});
  assert.match(enginePosition(x), / moves b3e3$/);
});

test('Move diversity is seeded per game and stays inside the score-loss bound; forced mates remain decisive', () => {
  const base = game(), legal = legalMoves(base), candidates = legal.slice(0,4).map((move,index) => ({uci:moveToUci('chess',move),score:100-index*8}));
  const bad = {uci:moveToUci('chess',legal[4]),score:-900};
  const selected = new Set();
  for(let n=0;n<100;n++) {
    const g={...base,id:`diverse-${n}`,difficulty:'hard'};
    const answer=selectEngineCandidate(g,[...candidates,bad]);
    assert.notEqual(moveToUci('chess',answer.move),bad.uci);
    assert.deepEqual(selectEngineCandidate(g,[...candidates,bad]),answer);
    selected.add(moveToUci('chess',answer.move));
  }
  assert.ok(selected.size>=3,`Expected several good moves, saw ${selected.size}`);
  assert.equal(moveToUci('chess',selectEngineCandidate(base,[{...candidates[0],score:99900},...candidates.slice(1)]).move),candidates[0].uci);
  assert.equal(selectEngineCandidate(base,[{uci:'z9z9',score:100}]),null);
});

test('An engine pool serializes requests, reuses processes and changes variants without exceeding its limit', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'sanco-engine-test-'));
  const log=path.join(directory,'events.log'), config=configuration('normal',log);
  const service=new NativeBotService({engines:{chess:config,xiangqi:config},maxProcesses:1,idleMs:10000});
  try {
    const inputs=[game('chess','one'),game('chess','two'),game('xiangqi','three')];
    const results=await Promise.all(inputs.map(input=>service.chooseMove(input)));
    results.forEach((result,index)=>{assert.ok(matches(legalMoves(inputs[index]),result.move));assert.equal(result.engine.name,'Test UCI engine');});
    await service.close();
    const lines=(await readFile(log,'utf8')).split('\n');
    let active=0,peak=0;
    for(const line of lines){if(line.startsWith('start '))peak=Math.max(peak,++active);if(line.startsWith('exit '))active--;}
    assert.equal(peak,1);assert.equal(active,0);assert.equal(lines.filter(line=>line.startsWith('start ')).length,2);
    assert.ok(lines.some(line=>line.includes('setoption name UCI_Variant value xiangqi')));
    assert.ok(lines.some(line=>line.includes('setoption name Threads value 1')));
  }finally {
    await service.close();
    const resolved=path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir())+path.sep)&&path.basename(resolved).startsWith('sanco-engine-test-'));
    await rm(resolved,{recursive:true,force:true});
  }
});

test('Malformed replies, crashes and startup timeouts release the native process and allow safe fallback', async () => {
  for(const mode of ['badmove','crash','hang']) {
    const service=new NativeBotService({engines:{chess:configuration(mode)},startupMs:mode==='hang'?80:2000});
    try {
      if(mode==='badmove')assert.equal(await service.chooseMove(game()),null);
      else await assert.rejects(service.chooseMove(game()),/deadline|exited/);
    }finally{await service.close();}
  }
  const missing=new UciEngine({path:path.join(tmpdir(),'sanco-nonexistent-engine.exe'),id:'missing'});
  try {await assert.rejects(missing.start('chess'));}finally{await missing.close();}
});

test('Closing the service rejects queued work and terminates the active engine', async () => {
  const service=new NativeBotService({engines:{chess:configuration('hang')},startupMs:2000});
  const results=Promise.allSettled([service.chooseMove(game()),service.chooseMove(game('chess','queued'))]);
  await service.close();
  assert.ok((await results).every(result=>result.status==='rejected'));
});

test('Practice persists only a legal engine result and uses the internal worker when the engine fails', async () => {
  for(const mode of ['normal','badmove']) {
    const db=await openDatabase({memory:true});
    const practice=new PracticeService(db,()=>{},{botWorkers:1,inactivityMs:0,engines:{engines:{chess:configuration(mode)},maxProcesses:1}});
    try {
      const player=await createGuest(db);
      const initial=await practice.create(player,{kind:'chess',side:'second',difficulty:'easy'});
      let finished;
      for(let n=0;n<280;n++){
        const {state}=await practice.read(initial.id);
        if(state.moves.length){finished=state;break;}
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      assert.ok(finished,'No bot result persisted');
      assert.equal(finished.moves.length,1);assert.equal(finished.turn,'b');
      const first=finished.moves[0];assert.ok(matches(legalMoves(game()),first));
      assert.equal(finished.botEngine?.id,mode==='normal'?'fixture-engine':undefined);
    }finally{await practice.close();await db.close();}
  }
});

test('Disabled native engines leave unrelated games and missing installations on the internal bot', async () => {
  assert.deepEqual(engineConfiguration({NATIVE_ENGINES:'false'}).engines,{});
  const service=new NativeBotService({engines:{}});
  try{assert.equal(await service.chooseMove(game()),null);assert.equal(await service.chooseMove(game('caro')),null);}finally{await service.close();}
});
