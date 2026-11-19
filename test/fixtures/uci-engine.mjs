import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const [mode = 'normal', log] = process.argv.slice(2);
const record = value => { if (log) appendFileSync(log, `${value}\n`); };
record(`start ${process.pid}`);
process.on('exit', () => record(`exit ${process.pid}`));
process.on('SIGTERM', () => process.exit(0));
let multiPv = 4;
createInterface({ input: process.stdin }).on('line', line => {
  record(`command ${process.pid} ${line}`);
  if (mode === 'hang') return;
  if (line === 'uci') {
    console.log('id name Test UCI engine');
    for (const name of ['Threads', 'Hash', 'MultiPV', 'Skill Level']) console.log(`option name ${name} type spin default 1 min 1 max 256`);
    console.log('option name UCI_Variant type combo default chess var chess var xiangqi');
    console.log('option name UCI_LimitStrength type check default false');
    console.log('uciok');
  } else if (line === 'isready') console.log('readyok');
  else if (line.startsWith('setoption name MultiPV value ')) multiPv = Number(line.split(' ').at(-1));
  else if (line.startsWith('go ')) {
    if (mode === 'crash') { process.exit(2); return; }
    const allMoves=line.split('searchmoves ')[1].split(' '),moves = allMoves.slice(0, multiPv);
    if (mode === 'badmove') { console.log('bestmove z9z9'); return; }
    moves.forEach((move, index) => console.log(`info depth 3 multipv ${index + 1} score cp ${30 - index * 4} pv ${move}`));
    console.log(`bestmove ${mode==='finalbest'?allMoves[1]:moves[0]}`);
  } else if (line === 'quit') process.exit(0);
});
