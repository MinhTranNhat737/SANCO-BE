import {ABSTRACT_KINDS,chooseAbstract} from './abstract-games.js';
import {chooseCommander} from './commander.js';
import { Chess } from 'chess.js';
import { winningLine } from './game.js';
import { X_VALUES, xLegal, xInCheck, xOther } from './xiangqi.js';
import { squareIndex, legalMoves } from './practice-engine.js';
import { discLegal, playDisc } from './disc-games.js';
import { ticLine, goPlay, goScore } from './grid-games.js';
import { PARTY_KINDS, chooseParty } from './party-games.js';
import {
  PESTO_MG_VALUE,
  PESTO_EG_VALUE,
  PHASE_WEIGHT,
  PESTO_MG_PST,
  PESTO_EG_PST,
  XIANGQI_PST,
  EDAX_REVERSI_WEIGHTS,
  lookupChessBook,
  lookupXiangqiBook,
  lookupCaroBook,
  lookupReversiBook,
  lookupGoFuseki,
  lookupCheckersBook,
  selectVariant,
} from './openings.js';

const CHESS_VALUES = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 20000 };
const TIMEOUT = Symbol('search deadline');

// ============================================================================
// 1. CARO / GOMOKU: Yixin / Rapfi Threat-Space & Alpha-Beta Engine
// ============================================================================
function caroLinePattern(board, row, col, dr, dc, mark) {
  let count = 1;
  let open = 0;
  let jump = 0;

  for (const sign of [-1, 1]) {
    let r = row + dr * sign;
    let c = col + dc * sign;
    while (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r * 15 + c] === mark) {
      count++;
      r += dr * sign;
      c += dc * sign;
    }
    if (r >= 0 && r < 15 && c >= 0 && c < 15 && !board[r * 15 + c]) {
      open++;
      // Check 1-space jump threat (e.g. X X _ X)
      const jr = r + dr * sign;
      const jc = c + dc * sign;
      if (jr >= 0 && jr < 15 && jc >= 0 && jc < 15 && board[jr * 15 + jc] === mark) {
        jump++;
      }
    }
  }
  return { count, open, jump };
}

function caroPointScore(board, to, mark) {
  const row = Math.floor(to / 15);
  const col = to % 15;
  let total = 0;
  let liveFours = 0;
  let rushFours = 0;
  let liveThrees = 0;

  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const { count, open, jump } = caroLinePattern(board, row, col, dr, dc, mark);
    if (count >= 5) {
      total += 1e8;
    } else if (count === 4) {
      if (open === 2) {
        liveFours++;
        total += 4500000;
      } else if (open === 1) {
        rushFours++;
        total += 380000;
      }
    } else if (count === 3) {
      if (jump >= 1 && open >= 1) {
        rushFours++;
        total += 320000;
      } else if (open === 2) {
        liveThrees++;
        total += 46000;
      } else if (open === 1) {
        total += 2200;
      }
    } else if (count === 2) {
      if (jump >= 1 && open === 2) {
        liveThrees++;
        total += 34000;
      } else if (open === 2) {
        total += 1100;
      } else if (open === 1) {
        total += 120;
      }
    } else if (open === 2) {
      total += 12;
    }
  }

  // Compound fork combinations (Four-Four, Four-Three, Double-Three)
  if (liveFours >= 1 || rushFours >= 2) total += 4000000;
  else if (rushFours >= 1 && liveThrees >= 1) total += 2200000;
  else if (liveThrees >= 2) total += 1500000;

  return total;
}

export function chooseCaro(game) {
  const board = [...game.board];
  const side = game.turn;
  const enemy = side === 'X' ? 'O' : 'X';

  if (board.every(p => !p)) return { from: null, to: 112 };

  const candidates = [];
  for (let to = 0; to < 225; to++) {
    if (!board[to]) {
      const row = Math.floor(to / 15);
      const col = to % 15;
      if (
        board.some(
          (p, i) => p && Math.abs(Math.floor(i / 15) - row) <= 2 && Math.abs((i % 15) - col) <= 2
        )
      ) {
        candidates.push(to);
      }
    }
  }
  if (!candidates.length) return { from: null, to: 112 };

  // 1. Immediate win or immediate block of 5-in-a-row
  for (const mark of [side, enemy]) {
    for (const to of candidates) {
      board[to] = mark;
      const win = winningLine(board, to).length;
      board[to] = null;
      if (win) return { from: null, to };
    }
  }

  // 2. Score all candidate squares for offensive & defensive threat patterns
  const ranked = candidates
    .map(to => {
      const attack = caroPointScore(board, to, side);
      const defend = caroPointScore(board, to, enemy);
      const centerBias = 14 - Math.abs((to % 15) - 7) - Math.abs(Math.floor(to / 15) - 7);
      return {
        to,
        attack,
        defend,
        value: attack + defend * 1.15 + centerBias * 3,
      };
    })
    .sort((a, b) => b.value - a.value);

  // 3. Check Renju/Gomoku Opening Playbook if no urgent tactical threat exists
  if (ranked[0].value < 30000) {
    const bookMove = lookupCaroBook(game);
    if (bookMove && !board[bookMove.to]) return bookMove;
  }

  if (game.difficulty === 'easy' && ranked[0].value < 40000) {
    return {
      from: null,
      to: ranked[Math.min(selectVariant(game.id, 3), ranked.length - 1)].to,
    };
  }

  // 4. Multi-ply tactical lookahead on Medium/Hard when top moves are close
  if (game.difficulty !== 'easy' && ranked[0].value < 3500000 && ranked.length > 1) {
    const topMoves = ranked.slice(0, game.difficulty === 'hard' ? 14 : 5);
    let bestTo = topMoves[0].to;
    let bestScore = -Infinity;

    for (const item of topMoves) {
      board[item.to] = side;
      // Evaluate opponent's strongest counter-threat on the next ply
      let maxEnemyReply = 0;
      for (const to of candidates) {
        const reply={to};
        if (board[to]) continue;
        const replyScore =
          caroPointScore(board, reply.to, enemy) + caroPointScore(board, reply.to, side) * 0.9;
        if (replyScore > maxEnemyReply) maxEnemyReply = replyScore;
      }
      board[item.to] = null;
      const net = item.value - maxEnemyReply * 0.65;
      if (net > bestScore) {
        bestScore = net;
        bestTo = item.to;
      }
    }
    return { from: null, to: bestTo };
  }

  return { from: null, to: ranked[0].to };
}

// ============================================================================
// 2. CHESS: PeSTO Tapered Eval + PVS Alpha-Beta + Quiescence + Polyglot Book
// ============================================================================
function pestoEval(chess) {
  const board = chess.board();
  let mgWhite = 0;
  let egWhite = 0;
  let mgBlack = 0;
  let egBlack = 0;
  let phase = 0;
  let whiteBishops = 0;
  let blackBishops = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const idx = r * 8 + c;
      const type = p.type;
      phase += PHASE_WEIGHT[type] || 0;
      if (p.color === 'w') {
        mgWhite += PESTO_MG_VALUE[type] + PESTO_MG_PST[type][idx];
        egWhite += PESTO_EG_VALUE[type] + PESTO_EG_PST[type][idx];
        if (type === 'b') whiteBishops++;
      } else {
        const flipIdx = (7 - r) * 8 + c;
        mgBlack += PESTO_MG_VALUE[type] + PESTO_MG_PST[type][flipIdx];
        egBlack += PESTO_EG_VALUE[type] + PESTO_EG_PST[type][flipIdx];
        if (type === 'b') blackBishops++;
      }
    }
  }

  if (whiteBishops >= 2) {
    mgWhite += 30;
    egWhite += 45;
  }
  if (blackBishops >= 2) {
    mgBlack += 30;
    egBlack += 45;
  }

  const mgPhase = Math.min(24, phase);
  const egPhase = 24 - mgPhase;
  const whiteScore = (mgWhite * mgPhase + egWhite * egPhase) / 24;
  const blackScore = (mgBlack * mgPhase + egBlack * egPhase) / 24;
  const evalWhite = whiteScore - blackScore;
  return chess.turn() === 'w' ? evalWhite : -evalWhite;
}

export function chooseChess(game) {
  const chess = new Chess(game.fen);
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return null;

  // 1. Check immediate checkmate in 1
  for (const m of legal) {
    chess.move(m);
    const isMate = chess.isCheckmate();
    chess.undo();
    if (isMate) {
      return {
        from: squareIndex(m.from),
        to: squareIndex(m.to),
        ...(m.promotion ? { promotion: m.promotion } : {}),
      };
    }
  }

  // 2. Consult Grandmaster Polyglot Opening Book on early plies
  if (game.difficulty !== 'easy') {
    const book = lookupChessBook(game);
    if (book) {
      const match = legal.find(
        m => squareIndex(m.from) === book.from && squareIndex(m.to) === book.to
      );
      if (match) {
        return {
          from: book.from,
          to: book.to,
          ...(match.promotion ? { promotion: match.promotion } : {}),
        };
      }
    }
  }

  const budget = { easy: 85, medium: 260, hard: 1600 }[game.difficulty] || 260;
  const maxDepth = { easy: 2, medium: 3, hard: 6 }[game.difficulty] || 3;
  const deadline = performance.now() + budget;
  const tt = new Map();
  const killers = Array.from({ length: 12 }, () => [null, null]);
  let nodes = 0;

  const moveScore = (m, ttBestUci, ply) => {
    const uci = m.from + m.to + (m.promotion || '');
    if (uci === ttBestUci) return 100000;
    let s = 0;
    if (m.captured) s += 10000 + (CHESS_VALUES[m.captured] || 100) * 10 - (CHESS_VALUES[m.piece] || 100);
    if (m.promotion) s += 9000 + (CHESS_VALUES[m.promotion] || 900);
    if (killers[ply]?.includes(uci)) s += 4000;
    return s;
  };

  // Quiescence Search to eliminate horizon-effect tactical blunders
  function qsearch(alpha, beta, qply) {
    if ((++nodes & 31) === 0 && performance.now() > deadline) throw TIMEOUT;
    if (chess.isCheckmate()) return -100000 + qply;
    if (chess.isDraw()) return 0;

    const standPat = pestoEval(chess);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qply >= 4) return standPat;

    const tactical = chess
      .moves({ verbose: true })
      .filter(m => m.captured || m.promotion)
      .sort((a, b) => moveScore(b, '', qply) - moveScore(a, '', qply));

    for (const move of tactical) {
      chess.move(move);
      let score;
      try {
        score = -qsearch(-beta, -alpha, qply + 1);
      } finally {
        chess.undo();
      }
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function search(depth, alpha, beta, ply) {
    if ((++nodes & 31) === 0 && performance.now() > deadline) throw TIMEOUT;
    if (chess.isCheckmate()) return -100000 + ply;
    if (chess.isDraw()) return 0;
    if (depth <= 0) return qsearch(alpha, beta, ply);

    const fenKey = chess.fen().split(' ').slice(0, 4).join(' ');
    const cached = tt.get(fenKey);
    if (cached && cached.depth >= depth && ply > 0) {
      if (cached.flag === 'EXACT') return cached.score;
      if (cached.flag === 'LOWER' && cached.score > alpha) alpha = cached.score;
      else if (cached.flag === 'UPPER' && cached.score < beta) beta = cached.score;
      if (alpha >= beta) return cached.score;
    }

    const moves = chess
      .moves({ verbose: true })
      .sort((a, b) => moveScore(b, cached?.bestUci, ply) - moveScore(a, cached?.bestUci, ply));

    let bestVal = -Infinity;
    let bestUci = '';
    const origAlpha = alpha;

    for (const move of moves) {
      chess.move(move);
      let score;
      try {
        score = -search(depth - 1, -beta, -alpha, ply + 1);
      } finally {
        chess.undo();
      }
      const uci = move.from + move.to + (move.promotion || '');
      if (score > bestVal) {
        bestVal = score;
        bestUci = uci;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (!move.captured && killers[ply]) {
          killers[ply][1] = killers[ply][0];
          killers[ply][0] = uci;
        }
        break;
      }
    }

    const flag = bestVal <= origAlpha ? 'UPPER' : bestVal >= beta ? 'LOWER' : 'EXACT';
    if (tt.size < 25000) tt.set(fenKey, { depth, score: bestVal, flag, bestUci });
    return bestVal;
  }

  let bestMove = legal[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    let iterBest = bestMove;
    let iterScore = -Infinity;
    let alpha = -Infinity;
    const rootMoves = [...legal].sort(
      (a, b) =>
        moveScore(b, bestMove.from + bestMove.to + (bestMove.promotion || ''), 0) -
        moveScore(a, bestMove.from + bestMove.to + (bestMove.promotion || ''), 0)
    );
    try {
      for (const move of rootMoves) {
        if (performance.now() > deadline) throw TIMEOUT;
        chess.move(move);
        let score;
        try {
          const nextKey = chess.fen().split(' ').slice(0, 4).join(' ');
          const repCount = game.repetitions?.[nextKey] || 0;
          score = -search(depth - 1, -Infinity, -alpha, 1);
          if (repCount >= 1 && score > -150) score -= repCount * 65; // Avoid pointless repetition when not losing
        } finally {
          chess.undo();
        }
        if (score > iterScore) {
          iterScore = score;
          iterBest = move;
        }
        if (score > alpha) alpha = score;
      }
      bestMove = iterBest;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }

  return {
    from: squareIndex(bestMove.from),
    to: squareIndex(bestMove.to),
    ...(bestMove.promotion ? { promotion: bestMove.promotion } : {}),
  };
}

// ============================================================================
// 3. XIANGQI: ElephantEye UCCI Evaluation + Quiescence + Classical Book
// ============================================================================
function xEval(board, side) {
  let total = 0;
  let redAdvisors = 0;
  let blackAdvisors = 0;
  let redElephants = 0;
  let blackElephants = 0;

  for (let i = 0; i < 90; i++) {
    const p = board[i];
    if (!p) continue;
    const pSide = p[0];
    const type = p[1];
    const pstIdx = pSide === 'r' ? i : 89 - i;
    const pstBonus = XIANGQI_PST[type]?.[pstIdx] || 0;
    const val = X_VALUES[type] + pstBonus * 2;
    total += pSide === side ? val : -val;

    if (type === 'A') pSide === 'r' ? redAdvisors++ : blackAdvisors++;
    if (type === 'B') pSide === 'r' ? redElephants++ : blackElephants++;
  }

  // Full guard structure bonus (Song Sĩ + Song Tượng)
  const redGuard = (redAdvisors === 2 ? 45 : 0) + (redElephants === 2 ? 35 : 0);
  const blackGuard = (blackAdvisors === 2 ? 45 : 0) + (blackElephants === 2 ? 35 : 0);
  total += side === 'r' ? redGuard - blackGuard : blackGuard - redGuard;

  return total;
}

export function chooseXiangqi(game) {
  const board = [...game.board];
  const side = game.turn;
  const rootMoves = xLegal(board, side);
  if (!rootMoves.length) return null;

  // 1. Consult Classical Chinese Opening Book on early plies
  if (game.difficulty !== 'easy') {
    const book = lookupXiangqiBook(game);
    if (book && rootMoves.some(m => m.from === book.from && m.to === book.to)) {
      return book;
    }
  }

  const deadline =
    performance.now() + ({ easy: 80, medium: 240, hard: 1500 }[game.difficulty] || 240);
  const maxDepth = { easy: 2, medium: 3, hard: 6 }[game.difficulty] || 3;
  let best = rootMoves[0];
  let nodes = 0;

  const orderMoves = (moves, preferred) =>
    moves.sort((a, b) => {
      const aPref = preferred && a.from === preferred.from && a.to === preferred.to ? 50000 : 0;
      const bPref = preferred && b.from === preferred.from && b.to === preferred.to ? 50000 : 0;
      const aCap = (X_VALUES[board[a.to]?.[1]] || 0) * 10 - (X_VALUES[board[a.from]?.[1]] || 0) / 10;
      const bCap = (X_VALUES[board[b.to]?.[1]] || 0) * 10 - (X_VALUES[board[b.from]?.[1]] || 0) / 10;
      return bPref + bCap - (aPref + aCap);
    });

  function qsearch(current, alpha, beta, qply) {
    if ((++nodes & 31) === 0 && performance.now() > deadline) throw TIMEOUT;
    const standPat = xEval(board, current);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qply >= 3) return standPat;

    const captures = xLegal(board, current).filter(m => board[m.to] !== null);
    for (const move of orderMoves(captures, null)) {
      const p = board[move.from];
      const cap = board[move.to];
      board[move.to] = p;
      board[move.from] = null;
      let score;
      try {
        score = -qsearch(xOther(current), -beta, -alpha, qply + 1);
      } finally {
        board[move.from] = p;
        board[move.to] = cap;
      }
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function search(current, depth, alpha, beta, ply) {
    if ((++nodes & 31) === 0 && performance.now() > deadline) throw TIMEOUT;
    const moves = xLegal(board, current);
    if (!moves.length) return -100000 + ply;
    if (depth <= 0) return qsearch(current, alpha, beta, ply);

    let value = -Infinity;
    for (const move of orderMoves(moves, null)) {
      const p = board[move.from];
      const capture = board[move.to];
      board[move.to] = p;
      board[move.from] = null;
      let score;
      try {
        score = -search(xOther(current), depth - 1, -beta, -alpha, ply + 1);
      } finally {
        board[move.from] = p;
        board[move.to] = capture;
      }
      if (score > value) value = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return value;
  }

  for (let depth = 1; depth <= maxDepth; depth++) {
    let iteration = best;
    let value = -Infinity;
    let alpha = -Infinity;
    try {
      for (const move of orderMoves([...rootMoves], best)) {
        if (performance.now() > deadline) throw TIMEOUT;
        const p = board[move.from];
        const capture = board[move.to];
        board[move.to] = p;
        board[move.from] = null;
        let score;
        try {
          score = -search(xOther(side), depth - 1, -Infinity, -alpha, 1);
        } finally {
          board[move.from] = p;
          board[move.to] = capture;
        }
        if (score > value) {
          value = score;
          iteration = move;
        }
        if (score > alpha) alpha = score;
      }
      best = iteration;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }
  return best;
}

// ============================================================================
// 4. REVERSI (Edax Engine) & CONNECT FOUR (Pascal Pons Solver)
// ============================================================================
function evaluateReversi(b, root) {
  const opp = root === 'B' ? 'W' : 'B';
  let emptyCount = 0;
  let ownDiscs = 0;
  let oppDiscs = 0;
  let posScore = 0;
  let frontierDiff = 0;

  // Dynamic corner adjustments (once a corner is owned, adjacent X/C squares are safe!)
  const weights = [...EDAX_REVERSI_WEIGHTS];
  for (const [corner, adj] of [
    [0, [1, 8, 9]],
    [7, [6, 14, 15]],
    [56, [48, 49, 57]],
    [63, [54, 55, 62]],
  ]) {
    if (b[corner]) {
      for (const sqIdx of adj) weights[sqIdx] = 24;
    }
  }

  for (let i = 0; i < 64; i++) {
    const v = b[i];
    if (!v) {
      emptyCount++;
      continue;
    }
    const sign = v === root ? 1 : -1;
    if (v === root) ownDiscs++;
    else oppDiscs++;
    posScore += weights[i] * sign;

    // Frontier disc check (adjacent to any empty square)
    const r = Math.floor(i / 8);
    const c = i % 8;
    let isFrontier = false;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && !b[nr * 8 + nc]) {
        isFrontier = true;
        break;
      }
    }
    if (isFrontier) frontierDiff -= sign * 6;
  }

  // Endgame: exact disc count dominates
  if (emptyCount === 0) return (ownDiscs - oppDiscs) * 1000;
  if (emptyCount <= 8) {
    return posScore * 0.4 + (ownDiscs - oppDiscs) * 28;
  }

  const ownMobility = discLegal('reversi', b, root).length;
  const oppMobility = discLegal('reversi', b, opp).length;
  return posScore + (ownMobility - oppMobility) * 14 + frontierDiff;
}

function evaluateConnect4(b, root) {
  let value = 0;
  // Center column control (col 3 is critical for horizontal/diagonal forks)
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const v = b[r * 7 + c];
      if (!v) continue;
      const centerBonus = [1, 3, 6, 11, 6, 3, 1][c];
      value += centerBonus * (v === root ? 1 : -1);
    }
  }

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        if (r + 3 * dr >= 6 || c + 3 * dc < 0 || c + 3 * dc >= 7) continue;
        let own = 0;
        let enemy = 0;
        for (let k = 0; k < 4; k++) {
          const v = b[(r + k * dr) * 7 + c + k * dc];
          if (v === root) own++;
          else if (v) enemy++;
        }
        if (!enemy && own > 0) value += [0, 2, 16, 120, 100000][own];
        if (!own && enemy > 0) value -= [0, 2, 18, 140, 100000][enemy];
      }
    }
  }
  return value;
}

export function chooseDiscs(game) {
  const root = game.turn;
  const enemy = root === 'B' ? 'W' : root === 'W' ? 'B' : root === 'R' ? 'Y' : 'R';
  const board = [...game.board];
  const moves = legalMoves(game);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];

  // Immediate win or immediate block for Connect Four
  if (game.kind === 'connect4') {
    for (const side of [root, enemy]) {
      for (const move of moves) {
        const next = [...board];
        const out = playDisc('connect4', next, move.to, side);
        if (out.result?.winner === side) return move;
      }
    }
    if (board.every(v => !v)) return moves.find(m => m.to % 7 === 3) || moves[0];
  } else if (game.difficulty !== 'easy') {
    // Reversi Opening Book
    const book = lookupReversiBook(game, moves);
    if (book) return book;
  }

  const deadline =
    performance.now() + ({ easy: 65, medium: 200, hard: 1400 }[game.difficulty] || 200);
  const emptyCount = board.filter(v => !v).length;
  const depthLimit =
    game.kind === 'connect4'
      ? { easy: 3, medium: 5, hard: 10 }[game.difficulty]
      : emptyCount <= 8 && game.difficulty === 'hard'
      ? 8
      : { easy: 2, medium: 4, hard: 8 }[game.difficulty];

  const evaluate = b => (game.kind === 'reversi' ? evaluateReversi(b, root) : evaluateConnect4(b, root));
  const tt = new Map();

  const orderDiscMoves = (b, list) =>
    game.kind === 'connect4'
      ? [...list].sort((a, bMove) => Math.abs((a.to % 7) - 3) - Math.abs((bMove.to % 7) - 3))
      : [...list].sort((a, bMove) => EDAX_REVERSI_WEIGHTS[bMove.to] - EDAX_REVERSI_WEIGHTS[a.to]);

  function search(b, turn, depth, alpha, beta) {
    if (performance.now() > deadline) throw TIMEOUT;
    if (depth <= 0) return evaluate(b);

    const key = b.map(v => v || '.').join('') + turn + depth;
    if (tt.has(key)) return tt.get(key);

    let value = turn === root ? -Infinity : Infinity;
    const legal = orderDiscMoves(b, discLegal(game.kind, b, turn));
    if (!legal.length) return evaluate(b);

    for (const move of legal) {
      const next = [...b];
      const out = playDisc(game.kind, next, move.to, turn);
      const score = out.result
        ? out.result.winner === null
          ? 0
          : out.result.winner === root
          ? 100000 + depth
          : -100000 - depth
        : search(next, out.turn, depth - 1, alpha, beta);

      if (turn === root) {
        if (score > value) value = score;
        if (value > alpha) alpha = value;
      } else {
        if (score < value) value = score;
        if (value < beta) beta = value;
      }
      if (alpha >= beta) break;
    }

    const res = Number.isFinite(value) ? value : evaluate(b);
    if (tt.size < 20000) tt.set(key, res);
    return res;
  }

  const orderedRoot = orderDiscMoves(board, moves);
  let best = orderedRoot[0];
  for (let depth = 1; depth <= depthLimit; depth++) {
    let iteration = best;
    let value = -Infinity;
    try {
      for (const move of orderedRoot) {
        const next = [...board];
        const out = playDisc(game.kind, next, move.to, root);
        const score = out.result
          ? out.result.winner === null
            ? 0
            : out.result.winner === root
            ? 100000 + depth
            : -100000 - depth
          : search(next, out.turn, depth - 1, -Infinity, Infinity);
        if (score > value) {
          value = score;
          iteration = move;
        }
      }
      best = iteration;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }
  return best || null;
}

// ============================================================================
// 5. GO 9x9 (Michi/Fuego Tactical + Area Engine), CHECKERS (Cake/Chinook), TICTACTOE
// ============================================================================
function goNeighbors(i) {
  const r = Math.floor(i / 9);
  const c = i % 9;
  const out = [];
  if (r > 0) out.push((r - 1) * 9 + c);
  if (r < 8) out.push((r + 1) * 9 + c);
  if (c > 0) out.push(r * 9 + c - 1);
  if (c < 8) out.push(r * 9 + c + 1);
  return out;
}

function goGroupInfo(board, idx) {
  const side = board[idx];
  const stones = new Set([idx]);
  const liberties = new Set();
  const queue = [idx];
  for (const at of queue) {
    for (const n of goNeighbors(at)) {
      if (!board[n]) liberties.add(n);
      else if (board[n] === side && !stones.has(n)) {
        stones.add(n);
        queue.push(n);
      }
    }
  }
  return { stones: [...stones], liberties: [...liberties] };
}

function isTrueEye(board, sqIdx, side) {
  const adj = goNeighbors(sqIdx);
  if (!adj.every(n => board[n] === side)) return false;
  // Check diagonals to ensure the eye cannot be falsified
  const r = Math.floor(sqIdx / 9);
  const c = sqIdx % 9;
  let enemyDiag = 0;
  let totalDiag = 0;
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9) {
      totalDiag++;
      if (board[nr * 9 + nc] && board[nr * 9 + nc] !== side) enemyDiag++;
    }
  }
  return totalDiag === 4 ? enemyDiag <= 1 : enemyDiag === 0;
}

function chooseGoMove(game, moves) {
  const side = game.turn;
  const opp = side === 'B' ? 'W' : 'B';
  const board = game.board;
  const playMoves = moves.filter(m => !m.pass);
  if (!playMoves.length) return moves.find(m => m.pass) || moves[0];

  // Identify own chains currently in Atari (1 liberty) that need rescue
  const endangeredLiberties = new Set();
  const seenOwn = new Set();
  for (let i = 0; i < 81; i++) {
    if (board[i] === side && !seenOwn.has(i)) {
      const g = goGroupInfo(board, i);
      g.stones.forEach(s => seenOwn.add(s));
      if (g.liberties.length === 1) endangeredLiberties.add(g.liberties[0]);
    }
  }

  // Consult 9x9 Fuseki Opening Book if in first 4 plies and no urgent tactical fight
  if ((game.moves?.length || 0) < 4 && endangeredLiberties.size === 0) {
    const hasCloseFight = board.some((v, idx) => {
      if (!v) return false;
      return goGroupInfo(board, idx).liberties.length <= 2;
    });
    if (!hasCloseFight) {
      const fuseki = lookupGoFuseki(game, playMoves);
      if (fuseki) return fuseki;
    }
  }

  const baseArea = goScore(board);
  const baseDiff = side === 'B' ? baseArea.B - baseArea.W : baseArea.W - baseArea.B;

  const ranked = [];
  for (const move of playMoves) {
    // Never fill own true eye unless forced
    if (isTrueEye(board, move.to, side)) continue;
    const out = goPlay(board, move.to, side, game.seenPositions);
    if (!out) continue;

    const myChain = goGroupInfo(out.board, move.to);
    // Avoid self-atari (putting own group into 1 liberty without capturing)
    if (myChain.liberties.length === 1 && out.captured.length === 0) continue;

    let value = out.captured.length * 140;
    // Saving our own chain from Atari
    if (endangeredLiberties.has(move.to) && myChain.liberties.length >= 2) {
      value += myChain.stones.length * 115;
    }

    // Putting opponent adjacent chains into Atari (1 liberty) or squeezing (2 liberties)
    for (const n of goNeighbors(move.to)) {
      if (out.board[n] === opp) {
        const enemyChain = goGroupInfo(out.board, n);
        if (enemyChain.liberties.length === 1) value += enemyChain.stones.length * 85;
        else if (enemyChain.liberties.length === 2) value += enemyChain.stones.length * 22;
      }
    }

    // Area score improvement & liberty health
    const nextArea = goScore(out.board);
    const nextDiff = side === 'B' ? nextArea.B - nextArea.W : nextArea.W - nextArea.B;
    value += (nextDiff - baseDiff) * 14 + Math.min(4, myChain.liberties.length) * 6;

    // 3rd/4th line Hoshi & Tengen positional preference
    const r = Math.floor(move.to / 9);
    const c = move.to % 9;
    const edgeDist = Math.min(r, 8 - r, c, 8 - c);
    value += edgeDist === 2 ? 12 : edgeDist === 3 || edgeDist === 4 ? 10 : edgeDist === 1 ? 4 : -4;

    ranked.push({ move, value });
  }

  ranked.sort((a, b) => b.value - a.value);
  if (!ranked.length) return moves.find(m => m.pass) || moves[0];

  // Pass gracefully if opponent passed and we are ahead or no worthwhile move exists
  if (game.passes && game.moves.length > 30 && (baseDiff > 2 || ranked[0].value < 8)) {
    return moves.find(m => m.pass) || ranked[0].move;
  }
  return ranked[0].move;
}

// Checkers (Cake / Chinook-inspired Multi-Jump Alpha-Beta Engine)
function evalCheckers(board, root) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    const side = p[0];
    const isKing = p[1] === 'K';
    const r = Math.floor(i / 8);
    const c = i % 8;
    let val = isKing ? 175 : 100;
    if (!isKing) {
      // Advancement bonus + Back-rank bridge guard bonus
      const advance = side === 'B' ? 7 - r : r;
      val += advance * 5;
      if ((side === 'B' && r === 7) || (side === 'W' && r === 0)) val += 14;
    }
    // Center control bonus
    if (r >= 2 && r <= 5 && c >= 2 && c <= 5) val += 8;
    score += side === root ? val : -val;
  }
  return score;
}

function simCheckersLegal(board, turn, forcedFrom = null) {
  const captures = [];
  const steps = [];
  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || piece[0] !== turn || (forcedFrom != null && from !== forcedFrom)) continue;
    const r = Math.floor(from / 8);
    const c = from % 8;
    const dirs = piece[1] === 'K' ? [-1, 1] : turn === 'B' ? [-1] : [1];
    for (const dr of dirs) {
      for (const dc of [-1, 1]) {
        const r1 = r + dr;
        const c1 = c + dc;
        if (r1 < 0 || r1 >= 8 || c1 < 0 || c1 >= 8) continue;
        const near = r1 * 8 + c1;
        if (!board[near] && forcedFrom == null) steps.push({ from, to: near });
        const r2 = r + dr * 2;
        const c2 = c + dc * 2;
        if (
          board[near] &&
          board[near][0] !== turn &&
          r2 >= 0 &&
          r2 < 8 &&
          c2 >= 0 &&
          c2 < 8 &&
          !board[r2 * 8 + c2]
        ) {
          captures.push({ from, to: r2 * 8 + c2 });
        }
      }
    }
  }
  return captures.length ? captures : forcedFrom != null ? [] : steps;
}

function applySimCheckers(board, turn, move) {
  const next = [...board];
  const piece = next[move.from];
  const dr = Math.abs(Math.floor(move.to / 8) - Math.floor(move.from / 8));
  next[move.to] = piece;
  next[move.from] = null;
  const jumped = dr === 2;
  if (jumped) next[(move.from + move.to) / 2] = null;
  const crowned = piece[1] === 'M' && (turn === 'B' ? move.to < 8 : move.to >= 56);
  if (crowned) next[move.to] = turn + 'K';
  let nextForced = null;
  let nextTurn = turn === 'B' ? 'W' : 'B';
  if (jumped && !crowned && simCheckersLegal(next, turn, move.to).length > 0) {
    nextForced = move.to;
    nextTurn = turn;
  }
  return { board: next, turn: nextTurn, forcedFrom: nextForced };
}

function chooseCheckersMove(game, moves) {
  if (moves.length === 1) return moves[0];
  if (game.difficulty !== 'easy') {
    const book = lookupCheckersBook(game, moves);
    if (book) return book;
  }

  const root = game.turn;
  const maxDepth = { easy: 2, medium: 4, hard: 9 }[game.difficulty] || 4;
  const deadline = performance.now() + ({ easy: 60, medium: 160, hard: 1200 }[game.difficulty] || 160);

  function search(b, turn, forcedFrom, depth, alpha, beta) {
    if (performance.now() > deadline) throw TIMEOUT;
    const legal = simCheckersLegal(b, turn, forcedFrom);
    if (!legal.length) return turn === root ? -50000 - depth : 50000 + depth;
    if (depth <= 0) return evalCheckers(b, root);

    let value = turn === root ? -Infinity : Infinity;
    for (const mv of legal) {
      const out = applySimCheckers(b, turn, mv);
      // Multi-jump continuation on the same turn does not decrement full depth
      const nextDepth = out.turn === turn ? depth : depth - 1;
      const score = search(out.board, out.turn, out.forcedFrom, nextDepth, alpha, beta);
      if (turn === root) {
        if (score > value) value = score;
        if (value > alpha) alpha = value;
      } else {
        if (score < value) value = score;
        if (value < beta) beta = value;
      }
      if (alpha >= beta) break;
    }
    return value;
  }

  let best = moves[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    let iterBest = best;
    let bestScore = -Infinity;
    try {
      for (const mv of moves) {
        const out = applySimCheckers(game.board, root, mv);
        const score = search(out.board, out.turn, out.forcedFrom, depth - 1, -Infinity, Infinity);
        if (score > bestScore) {
          bestScore = score;
          iterBest = mv;
        }
      }
      best = iterBest;
    } catch (error) {
      if (error !== TIMEOUT) throw error;
      break;
    }
  }
  return best;
}

export function chooseGrid(game) {
  const moves = legalMoves(game);
  if (!moves.length) return null;
  if (game.kind === 'go') return chooseGoMove(game, moves);
  if (game.kind === 'checkers') return chooseCheckersMove(game, moves);

  // Tic-Tac-Toe Perfect Alpha-Beta Minimax with varied Fork Playbooks
  const board = [...game.board];
  const root = game.turn;
  const other = s => (s === 'X' ? 'O' : 'X');

  // Immediate win or block check first
  for (const side of [root, other(root)]) {
    for (const move of moves) {
      board[move.to] = side;
      const win = ticLine(board).length > 0;
      board[move.to] = null;
      if (win) return move;
    }
  }

  // Opening variety on empty board (Center or Corner Fork Playbook)
  if (board.every(v => !v)) {
    const openings = [4, 0, 2, 6, 8];
    const target = openings[selectVariant(game.id, openings.length)];
    return moves.find(m => m.to === target) || moves[0];
  }

  function search(side, ply) {
    const line = ticLine(board);
    if (line.length) return board[line[0]] === root ? 20 - ply : -20 + ply;
    if (!board.includes(null)) return 0;
    const scores = [];
    for (let i = 0; i < 9; i++) {
      if (!board[i]) {
        board[i] = side;
        scores.push(search(other(side), ply + 1));
        board[i] = null;
      }
    }
    return side === root ? Math.max(...scores) : Math.min(...scores);
  }

  return moves
    .map(move => {
      board[move.to] = root;
      const value = search(other(root), 1);
      board[move.to] = null;
      return { move, value };
    })
    .sort((a, b) => b.value - a.value || Math.abs(a.move.to - 4) - Math.abs(b.move.to - 4))[0]
    .move;
}

export function chooseBotMove(game) {
  if(game.bot&&game.bot.elo<1700){
    // Elo labels start as estimates. Higher profiles make fewer random errors;
    // the existing difficulty also increases search strength and time budget.
    const errorRate=.85*Math.max(0,(2200-game.bot.elo)/1800)**2;
    if(Math.random()<errorRate){const moves=legalMoves(game);if(moves.length)return moves[Math.floor(Math.random()*moves.length)];}
  }
  if(game.kind==='commander')return chooseCommander(game);
  if(ABSTRACT_KINDS.includes(game.kind))return chooseAbstract(game);
  return PARTY_KINDS.includes(game.kind)
    ? chooseParty(game)
    : ['go', 'checkers', 'tictactoe'].includes(game.kind)
    ? chooseGrid(game)
    : game.kind === 'caro'
    ? chooseCaro(game)
    : game.kind === 'chess'
    ? chooseChess(game)
    : game.kind === 'xiangqi'
    ? chooseXiangqi(game)
    : chooseDiscs(game);
}
