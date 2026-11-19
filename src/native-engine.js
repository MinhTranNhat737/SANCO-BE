import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Chess } from 'chess.js';
import { chessSquare, legalMoves, positionKey } from './practice-engine.js';
import { selectVariant } from './openings.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const STYLES = ['balanced', 'attacking', 'positional', 'solid'];
export const ENGINE_STYLE_NAMES = { balanced: 'Cân bằng', attacking: 'Chủ động', positional: 'Thế trận', solid: 'Chắc chắn', precise: 'Tối ưu' };

function integer(value, fallback, min, max, name) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return number;
}

export function engineConfiguration(env = process.env) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const paths = {
    chess: env.STOCKFISH_PATH || path.join(root, '.engines', 'stockfish', `stockfish${suffix}`),
    xiangqi: env.FAIRY_STOCKFISH_PATH || path.join(root, '.engines', 'fairy-stockfish', `fairy-stockfish${suffix}`),
  };
  return {
    engines: Object.fromEntries(Object.entries(paths).filter(([, executable]) => env.NATIVE_ENGINES !== 'false' && existsSync(executable)).map(([kind, executable]) => [kind, { path: executable, id: kind === 'chess' ? 'stockfish' : 'fairy-stockfish' }])),
    maxProcesses: integer(env.ENGINE_PROCESSES, 1, 1, 4, 'ENGINE_PROCESSES'),
    hashMb: integer(env.ENGINE_HASH_MB, 16, 8, 128, 'ENGINE_HASH_MB'),
  };
}

// Fairy-Stockfish's UCI protocol uses ranks 1..10 for Xiangqi (UCCI uses 0..9).
export function moveToUci(kind, move) {
  const square = kind === 'chess' ? chessSquare : index => `${'abcdefghi'[index % 9]}${10 - Math.floor(index / 9)}`;
  return `${square(move.from)}${square(move.to)}${move.promotion || ''}`;
}

export function xiangqiFen(board, turn = 'r', halfmove = 0, fullmove = 1) {
  const rows = [];
  for (let row = 0; row < 10; row++) {
    let encoded = '', empty = 0;
    for (const piece of board.slice(row * 9, row * 9 + 9)) {
      if (!piece) { empty++; continue; }
      if (empty) { encoded += empty; empty = 0; }
      encoded += piece[0] === 'r' ? piece[1] : piece[1].toLowerCase();
    }
    if (empty) encoded += empty;
    rows.push(encoded);
  }
  return `${rows.join('/')} ${turn === 'r' ? 'w' : 'b'} - - ${halfmove} ${fullmove}`;
}

export function enginePosition(game) {
  const history = game.moves || [];
  if (game.kind === 'chess') {
    if (!game.initialFen || !history.length) return `position fen ${game.fen}`;
    return `position fen ${game.initialFen} moves ${history.map(move => moveToUci('chess', move)).join(' ')}`;
  }
  if (history.length && game.initialBoard?.length === 90) {
    return `position fen ${xiangqiFen(game.initialBoard)} moves ${history.map(move => moveToUci('xiangqi', move)).join(' ')}`;
  }
  return `position fen ${xiangqiFen(game.board, game.turn, game.noCapture || 0, Math.floor(history.length / 2) + 1)}`;
}

export function engineStrength(game) {
  const levels = { easy: { ms: 100, depth: 5, loss: 160, multiPv: 4 }, medium: { ms: 500, depth: 12, loss: 40, multiPv: 4 }, hard: { ms: 3000, depth: null, loss: 0, multiPv: 1 } };
  const level = levels[game.difficulty] || levels.medium;
  if (!game.bot) return level;
  const elo=Number.isFinite(game.bot.elo)?game.bot.elo:1000;
  if(elo>=2200){
    const scale=Math.min(1,(elo-2200)/1000);
    return {ms:Math.round(1800+3200*scale),depth:null,loss:0,multiPv:1};
  }
  const scale = Math.max(0, Math.min(1, (elo - 400) / 1800));
  return { ms: Math.round(90 + 1410 * scale * scale), depth: Math.round(4 + 16 * scale), loss: Math.round(200 * (1-scale)**2), multiPv: 4 };
}

function randomUnit(seed) { return selectVariant(seed, 1_000_003) / 1_000_003; }

function repetitionPenalty(game, move) {
  try {
    let key;
    if (game.kind === 'chess') {
      const chess = new Chess(game.fen);
      chess.move({ from: chessSquare(move.from), to: chessSquare(move.to), ...(move.promotion ? { promotion: move.promotion } : {}) });
      key = chess.fen().split(' ').slice(0, 4).join(' ');
    } else {
      const board = [...game.board]; board[move.to] = board[move.from]; board[move.from] = null;
      key = positionKey({ ...game, board, turn: game.turn === 'r' ? 'b' : 'r' });
    }
    return game.repetitions?.[key] ? 0.15 : 1;
  } catch { return 1; }
}

export function selectEngineCandidate(game, candidates, legal = legalMoves(game)) {
  const strength = engineStrength(game);
  const style = STYLES[selectVariant(game.id, STYLES.length)];
  const available = candidates.map(candidate => ({ ...candidate, move: legal.find(move => moveToUci(game.kind, move) === candidate.uci) })).filter(candidate => candidate.move && Number.isFinite(candidate.score));
  if (!available.length) return null;
  const best = Math.max(...available.map(candidate => candidate.score));
  const eligible = available.filter(candidate => best - candidate.score <= strength.loss);
  if(strength.loss===0)return {move:eligible[0].move,style:'precise'};
  const lastOwn = game.moves?.findLast(move => move.side === game.turn);
  const weighted = eligible.map(candidate => {
    const move = candidate.move, piece = game.board[move.from]?.[1], capture = Boolean(game.board[move.to]);
    let bias = 1;
    if (style === 'attacking' && capture) bias = 1.5;
    if (style === 'positional' && ['N', 'B', 'C'].includes(piece) && !capture) bias = 1.5;
    if (style === 'solid' && (piece === 'K' || piece === 'A' || piece === 'B')) bias = 1.3;
    if (lastOwn?.from === move.to && lastOwn?.to === move.from) bias *= 0.2;
    return { ...candidate, weight: Math.exp((candidate.score - best) / Math.max(12, strength.loss / 2)) * bias * repetitionPenalty(game, move) };
  });
  const seed = `${game.id}:${game.moves?.length || 0}:${game.bot?.id || game.difficulty}`;
  let choice = randomUnit(seed) * weighted.reduce((sum, candidate) => sum + candidate.weight, 0);
  for (const candidate of weighted) { choice -= candidate.weight; if (choice <= 0) return { move: candidate.move, style }; }
  return { move: weighted.at(-1).move, style };
}

export class UciEngine {
  constructor(config, { hashMb = 16, startupMs = 4000 } = {}) {
    this.config = config; this.hashMb = hashMb; this.startupMs = startupMs;
    this.options = new Set(); this.name = config.id; this.waiter = null; this.dead = false; this.lastGame = null;
  }
  async start(kind) {
    this.child = spawn(this.config.path, this.config.args || [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.closedPromise = new Promise(resolve => this.child.once('close', () => { this.exited = true; resolve(); }));
    this.reader = createInterface({ input: this.child.stdout });
    this.reader.on('line', line => {
      if (line.length > 32768) { this.fail(new Error('Engine output line exceeded limit')); return; }
      if (line.startsWith('id name ')) this.name = line.slice(8).trim().slice(0, 100);
      const option = line.match(/^option name (.*?) type /); if (option) this.options.add(option[1]);
      this.onInfo?.(line);
      if (this.waiter?.match(line)) { const waiter = this.waiter; this.waiter = null; clearTimeout(waiter.timer); waiter.resolve(line); }
    });
    // Drain stderr to prevent child-process backpressure; never expose engine input.
    this.child.stderr.on('data', () => {});
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(new Error('Engine process exited')));
    await this.command('uci', line => line === 'uciok', this.startupMs);
    if (kind === 'xiangqi' && !this.options.has('UCI_Variant')) throw new Error('Xiangqi engine must support UCI_Variant');
    this.option('Threads', 1); this.option('Hash', this.hashMb); this.option('Ponder', false);
    this.option('Skill Level', 20); this.option('UCI_LimitStrength', false);
    if (kind === 'xiangqi') this.option('UCI_Variant', 'xiangqi');
    await this.command('isready', line => line === 'readyok', this.startupMs);
    return this;
  }
  write(command) {
    if (this.dead || !this.child?.stdin.writable) throw new Error('Engine is unavailable');
    if (/[\r\n]/.test(command)) throw new Error('Invalid UCI command');
    this.child.stdin.write(`${command}\n`);
  }
  option(name, value) { if (this.options.has(name)) this.write(`setoption name ${name} value ${value}`); }
  command(command, match, timeout) {
    if (this.waiter) return Promise.reject(new Error('Engine already has a pending command'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Engine response deadline exceeded')), timeout);
      this.waiter = { match, resolve, reject, timer };
      try { this.write(command); } catch (error) { this.fail(error); }
    });
  }
  fail(error) {
    this.dead = true;
    if (this.waiter) { const waiter = this.waiter; this.waiter = null; clearTimeout(waiter.timer); waiter.reject(error); }
    this.reader?.close(); this.child?.kill();
  }
  async search(game) {
    const legal = legalMoves(game); if (!legal.length) return null;
    const strength = engineStrength(game),count = Math.min(strength.multiPv, legal.length),iterations = new Map();
    const analysis={depth:0,nodes:0,timeMs:0};
    this.option('MultiPV', count);
    if (this.lastGame !== game.id) { this.write('ucinewgame'); this.lastGame = game.id; }
    await this.command('isready', line => line === 'readyok', this.startupMs);
    this.write(enginePosition(game));
    this.onInfo = line => {
      for(const [field,pattern] of [['depth',/\bdepth (\d+)/],['nodes',/\bnodes (\d+)/],['timeMs',/\btime (\d+)/]]){
        const match=line.match(pattern);if(match)analysis[field]=Math.max(analysis[field],Number(match[1]));
      }
      const depth = line.match(/\bdepth (\d+)/), score = line.match(/\bscore (cp|mate) (-?\d+)/), pv = line.match(/\bpv (\S+)/);
      if (!depth || !score || !pv || /\b(?:lowerbound|upperbound)\b/.test(line)) return;
      const number = Number(score[2]);
      const value = score[1] === 'mate' ? (number > 0 ? 100000 - number * 100 : -100000 - number * 100) : Math.max(-90000, Math.min(90000, number));
      const ply = Number(depth[1]), index = Number(line.match(/\bmultipv (\d+)/)?.[1] || 1);
      if (!iterations.has(ply)) iterations.set(ply, new Map());
      iterations.get(ply).set(index, { uci: pv[1], score: value });
      if (iterations.size > 6) iterations.delete(Math.min(...iterations.keys()));
    };
    let best;
    try {
      best = await this.command(`go ${strength.depth?`depth ${strength.depth} `:''}movetime ${strength.ms} searchmoves ${legal.map(move => moveToUci(game.kind, move)).join(' ')}`, line => line.startsWith('bestmove '), strength.ms + 2000);
    } finally { this.onInfo = null; }
    const complete = [...iterations].filter(([, lines]) => lines.size === count).sort((a, b) => b[0] - a[0])[0];
    const candidates = complete ? [...complete[1].values()] : [{ uci: best.split(/\s+/)[1], score: 0 }];
    // At full strength use the engine's final decision, including improvements
    // from a partial last iteration. Earlier MultiPV lines can be stale.
    const finalMove=legal.find(move=>moveToUci(game.kind,move)===best.split(/\s+/)[1]);
    const chosen = strength.loss===0?(finalMove?{move:finalMove,style:'precise'}:null):selectEngineCandidate(game, candidates, legal);
    return chosen ? { move: chosen.move, engine: { id: this.config.id, name: this.name, style: chosen.style, styleName: ENGINE_STYLE_NAMES[chosen.style] },analysis } : null;
  }
  async close() {
    if (!this.child || this.exited) return;
    if (this.closingPromise) return this.closingPromise;
    this.closingPromise = (async () => {
      this.dead = true; this.onInfo = null;
      if (this.waiter) { const waiter = this.waiter; this.waiter = null; clearTimeout(waiter.timer); waiter.reject(new Error('Engine closed')); }
      try { this.child.stdin.end('quit\n'); } catch { this.child.kill(); }
      const killTimer = setTimeout(() => this.child.kill('SIGKILL'), 500);
      try { await this.closedPromise; } finally { clearTimeout(killTimer); this.reader?.close(); }
    })();
    return this.closingPromise;
  }
}

// A bounded pool owns native processes in the parent, so terminating a JS worker
// cannot leave an orphaned Stockfish process. One process is the production default.
export class NativeBotService {
  constructor(options = engineConfiguration()) {
    this.engines = options.engines || {}; this.hashMb = options.hashMb || 16;
    this.startupMs = options.startupMs || 4000; this.idleMs = options.idleMs ?? 30000;
    this.slots = Array.from({ length: options.maxProcesses || 1 }, () => ({ busy: false, engine: null, kind: null, timer: null }));
    this.queue = []; this.closed = false;
  }
  chooseMove(game) {
    if (this.closed || !this.engines[game.kind]) return Promise.resolve(null);
    return new Promise((resolve, reject) => { this.queue.push({ game, resolve, reject }); this.pump(); });
  }
  pump() {
    if (this.closed) return;
    while (this.queue.length) {
      const job = this.queue[0], slot = this.slots.find(item => !item.busy && item.kind === job.game.kind) || this.slots.find(item => !item.busy);
      if (!slot) return;
      this.queue.shift(); slot.busy = true; clearTimeout(slot.timer);
      this.run(slot, job.game).then(job.resolve, job.reject).finally(() => {
        slot.busy = false;
        if (!this.closed) {
          slot.timer = setTimeout(() => { if (!slot.busy) { const engine = slot.engine; slot.engine = null; slot.kind = null; void engine?.close(); } }, this.idleMs);
          slot.timer.unref(); this.pump();
        }
      });
    }
  }
  async run(slot, game) {
    try {
      if (!slot.engine || slot.engine.dead || slot.kind !== game.kind) {
        await slot.engine?.close();
        if (this.closed) throw new Error('Engine service closed');
        slot.engine = new UciEngine(this.engines[game.kind], { hashMb: this.hashMb, startupMs: this.startupMs }); slot.kind = game.kind;
        await slot.engine.start(game.kind);
      }
      return await slot.engine.search(game);
    } catch (error) {
      await slot.engine?.close(); slot.engine = null; slot.kind = null;
      throw error;
    }
  }
  async close() {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(new Error('Engine service closed'));
    await Promise.all(this.slots.map(slot => { clearTimeout(slot.timer); return slot.engine?.close(); }));
  }
}
