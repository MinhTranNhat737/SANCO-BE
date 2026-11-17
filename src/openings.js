// Open-source AI Opening Books ("Bài đánh khai cuộc") and Piece-Square Tables
// Inspired by Polyglot/PeSTO (Chess), ElephantEye (Xiangqi), Yixin/Rapfi (Caro/Gomoku),
// Edax (Reversi), Michi/Pachi (9x9 Go), and Cake/Chinook (Checkers).

const sq = algebraic => (8 - Number(algebraic[1])) * 8 + algebraic.charCodeAt(0) - 97;
const xSq = coord => (10 - Number(coord.slice(1))) * 9 + coord.charCodeAt(0) - 65;

/**
 * Deterministic hash from game ID + ply count so each new game selects a different
 * authentic opening playbook while remaining reproducible.
 */
export function selectVariant(seedStr, count) {
  if (!count || count <= 1) return 0;
  let hash = 2166136261;
  const s = String(seedStr || 'sanco');
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % count;
}

// ============================================================================
// 1. CHESS: PeSTO (RofChade / Sunfish) Tapered Middlegame & Endgame Tables
// ============================================================================
// Tables are from White's perspective (index 0 = a8, index 63 = h1).
export const PESTO_MG_VALUE = { p: 82, n: 337, b: 365, r: 477, q: 1025, k: 20000 };
export const PESTO_EG_VALUE = { p: 94, n: 281, b: 297, r: 512, q: 936, k: 20000 };
export const PHASE_WEIGHT = { p: 0, n: 1, b: 1, r: 2, q: 4, k: 0 };

export const PESTO_MG_PST = {
  p: [
      0,   0,   0,   0,   0,   0,   0,   0,
     98, 134,  61,  95,  68, 126,  34, -11,
     -6,   7,  26,  31,  65,  56,  25, -20,
    -14,  13,   6,  21,  23,  12,  17, -23,
    -27,  -2,  -5,  12,  17,   6,  10, -25,
    -26,  -4,  -4, -10,   3,   3,  33, -12,
    -35,  -1, -20, -23, -15,  24,  38, -22,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  n: [
   -167, -89, -34, -49,  61, -97, -15,-107,
    -73, -41,  72,  36,  23,  62,   7, -17,
    -47,  60,  37,  65,  84, 129,  73,  44,
     -9,  17,  19,  53,  37,  69,  18,  22,
    -13,   4,  16,  13,  28,  19,  21,  -8,
    -23,  -9,  12,  10,  19,  17,  25, -16,
    -29, -53, -12,  -3,  -1,  18, -14, -19,
   -105, -21, -58, -33, -17, -28, -19, -23,
  ],
  b: [
    -29,   4, -82, -37, -25, -42,   7,  -8,
    -26,  16, -18, -13,  30,  59,  18, -47,
    -16,  37,  43,  40,  35,  50,  37,  -2,
     -4,   5,  19,  50,  37,  37,   7,  -2,
     -6,  13,  13,  26,  34,  12,  10,   4,
      0,  15,  15,  15,  14,  27,  18,  10,
      4,  15,  16,   0,   7,  21,  33,   1,
    -33,  -3, -14, -21, -13, -12, -39, -21,
  ],
  r: [
     32,  42,  32,  51,  63,   9,  31,  43,
     27,  32,  58,  62,  80,  67,  26,  44,
     -5,  19,  26,  36,  17,  45,  61,  16,
    -24, -11,   7,  26,  24,  35,  -8, -20,
    -36, -26, -12,  -1,   9,  -7,   6, -23,
    -45, -25, -16, -17,   3,   0,  -5, -33,
    -44, -16, -20,  -9,  -1,  11,  -6, -71,
    -19, -13,   1,  17,  16,   7, -37, -26,
  ],
  q: [
    -28,   0,  29,  12,  59,  44,  43,  45,
    -24, -39,  -5,   1, -16,  57,  28,  54,
    -13, -17,   7,   8,  29,  56,  47,  57,
    -27, -27, -16, -16,  -1,  17,  -2,   1,
     -9, -26,  -9, -10,  -2,  -4,   3,  -3,
    -14,   2, -11,  -2,  -5,   2,  14,   5,
    -35,  -8,  11,   2,   8,  15,  -3,   1,
     -1, -18,  -9,  10, -15, -25, -31, -50,
  ],
  k: [
    -65,  23,  16, -15, -56, -34,   2,  13,
     29,  -1, -20,  -7,  -8,  -4, -38, -29,
     -9,  24,   2, -16, -20,   6,  22, -22,
    -17, -20, -12, -27, -30, -25, -14, -36,
    -49,  -1, -27, -39, -46, -44, -33, -51,
    -14, -14, -22, -46, -44, -30, -15, -27,
      1,   7,  -8, -64, -43, -16,   9,   8,
    -15,  36,  12, -54,   8, -28,  24,  14,
  ],
};

export const PESTO_EG_PST = {
  p: [
      0,   0,   0,   0,   0,   0,   0,   0,
    178, 173, 158, 134, 147, 132, 165, 187,
     94, 100,  85,  67,  56,  53,  82,  84,
     32,  24,  13,   5,  -2,   4,  17,  17,
     13,   9,  -3,  -7,  -7,  -8,   3,  -1,
      4,   7,  -6,   1,   0,  -5,  -1,  -8,
     13,   8,   8,  10,  13,   0,   2,  -7,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  n: [
    -58, -38, -13, -28, -31, -27, -63, -99,
    -25,  -8, -25,  -2,  -9, -25, -24, -52,
    -24, -20,  10,   9,  -1,  -9, -19, -41,
    -17,   3,  22,  22,  22,  11,   8, -18,
    -18,  -6,  16,  25,  16,  17,   4, -18,
    -23,  -3,  -1,  15,  10,  -3, -20, -22,
    -42, -20, -10,  -5,  -2, -20, -23, -44,
    -29, -51, -23, -15, -22, -18, -50, -64,
  ],
  b: [
    -14, -21, -11,  -8,  -7,  -9, -17, -24,
     -8,  -4,   7, -12,  -3, -13,  -4, -14,
      2,  -8,   0,  -1,  -2,   6,   0,   4,
     -3,   9,  12,   9,  14,  10,   3,   2,
     -6,   3,  13,  19,   7,  10,  -3,  -9,
    -12,  -3,   8,  10,  13,   3,  -7, -15,
    -14, -18,  -7,  -1,   4,  -9, -15, -27,
    -23,  -9, -23,  -5,  -9, -16,  -5, -17,
  ],
  r: [
     13,  10,  18,  15,  12,  12,   8,   5,
     11,  13,  13,  11,  -3,   3,   8,   3,
      7,   7,   7,   5,   4,  -3,  -5,  -3,
      4,   3,  13,   1,   2,   1,  -1,   2,
      3,   5,   8,   4,  -5,  -6,  -8, -11,
     -4,   0,  -5,  -1,  -7, -12,  -8, -16,
     -6,  -6,   0,   2,  -9,  -9, -11,  -3,
     -9,   2,   3,  -1,  -5, -13,   4, -20,
  ],
  q: [
     -9,  22,  22,  27,  27,  19,  10,  20,
    -17,  20,  32,  41,  58,  25,  30,   0,
    -20,   6,   9,  49,  47,  35,  19,   9,
      3,  22,  24,  45,  57,  40,  57,  36,
    -18,  28,  19,  47,  31,  34,  39,  23,
    -16, -27,  15,   6,   9,  17,  10,   5,
    -22, -23, -30, -16, -16, -23, -36, -32,
    -33, -28, -22, -43,  -5, -32, -20, -41,
  ],
  k: [
    -74, -35, -18, -18, -11,  15,   4, -17,
    -12,  17,  14,  17,  17,  38,  23,  11,
     10,  17,  23,  15,  20,  45,  44,  13,
     -8,  22,  24,  27,  26,  33,  26,   3,
    -18,  -4,  21,  24,  27,  23,   9, -11,
    -19,  -3,  11,  21,  23,  16,   7,  -9,
    -27, -11,   4,  13,  14,   4,  -5, -17,
    -53, -34, -21, -11, -28, -14, -24, -43,
  ],
};

// Polyglot-inspired Grandmaster Opening Book Lines (18 distinct playbooks)
const CHESS_BOOK_LINES = [
  // 1. Ruy Lopez (Tây Ban Nha)
  ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7'],
  // 2. Italian Game - Giuoco Piano (Khai cuộc Ý)
  ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d3', 'd7d6'],
  // 3. Two Knights Defense (Phòng thủ Hai Mã)
  ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'd2d4', 'e5d4', 'e1g1', 'f6e4'],
  // 4. Scotch Game (Khai cuộc Scotland)
  ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4', 'f3d4', 'g8f6', 'b1c3', 'f8b4'],
  // 5. Sicilian Najdorf (Phòng thủ Sicily - Najdorf)
  ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6'],
  // 6. Sicilian Dragon (Phòng thủ Sicily - Rồng)
  ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'g7g6'],
  // 7. French Defense (Phòng thủ Pháp)
  ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'g8f6', 'c1g5', 'f8e7', 'e4e5', 'f6d7'],
  // 8. Caro-Kann Classical (Phòng thủ Caro-Kann)
  ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'd5e4', 'c3e4', 'c8f5', 'e4g3', 'f5g6'],
  // 9. Scandinavian Defense (Phòng thủ Scandinavia)
  ['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5a5', 'd2d4', 'g8f6', 'g1f3', 'c8f5'],
  // 10. Queen's Gambit Declined (Gambit Hậu từ chối)
  ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c1g5', 'f8e7', 'e2e3', 'e8g8'],
  // 11. Slav Defense (Phòng thủ Slav)
  ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3', 'g8f6', 'b1c3', 'd5c4', 'a2a4', 'c8f5'],
  // 12. London System (Hệ thống London)
  ['d2d4', 'd7d5', 'c1f4', 'g8f6', 'e2e3', 'c7c5', 'c2c3', 'b8c6', 'b1d2', 'e7e6'],
  // 13. King's Indian Defense (Phòng thủ Ấn Độ Vua)
  ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4', 'd7d6', 'g1f3', 'e8g8'],
  // 14. Nimzo-Indian Defense (Phòng thủ Nimzo-Ấn Độ)
  ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4', 'e2e3', 'e8g8', 'f1d3', 'd7d5'],
  // 15. English Symmetrical (Khai cuộc Anh)
  ['c2c4', 'c7c5', 'b1c3', 'b8c6', 'g2g3', 'g7g6', 'f1g2', 'f8g7', 'g1f3', 'g8f6'],
  // 16. Reti / King's Indian Attack
  ['g1f3', 'd7d5', 'g2g3', 'g8f6', 'f1g2', 'c7c6', 'e1g1', 'c8f5', 'd2d3', 'e7e6'],
];

export function lookupChessBook(game) {
  const history = game.moves || [];
  if (history.length >= 10) return null;
  const played = history.map(m => {
    const f = `${'abcdefgh'[m.from % 8]}${8 - Math.floor(m.from / 8)}`;
    const t = `${'abcdefgh'[m.to % 8]}${8 - Math.floor(m.to / 8)}`;
    return f + t;
  });
  const candidates = [];
  for (const line of CHESS_BOOK_LINES) {
    if (line.length <= played.length) continue;
    if (played.every((u, idx) => line[idx] === u)) {
      const nextUci = line[played.length];
      candidates.push({
        from: sq(nextUci.slice(0, 2)),
        to: sq(nextUci.slice(2, 4)),
      });
    }
  }
  if (!candidates.length) return null;
  return candidates[selectVariant(`${game.id}:${history.length}`, candidates.length)];
}

// ============================================================================
// 2. XIANGQI: ElephantEye (UCCI Open-Source) PSTs & Classical Chinese Playbooks
// ============================================================================
// 90-square tables from Red's perspective (row 0 = top enemy rank, row 9 = bottom Red rank).
export const XIANGQI_PST = {
  P: [
     9,  9,  9, 11, 13, 11,  9,  9,  9,
    35, 42, 54, 64, 70, 64, 54, 42, 35,
    30, 38, 48, 58, 62, 58, 48, 38, 30,
    22, 28, 36, 45, 50, 45, 36, 28, 22,
    14, 18, 24, 32, 36, 32, 24, 18, 14,
     4,  0,  8,  0, 12,  0,  8,  0,  4,
     0,  0, -2,  0,  6,  0, -2,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
     0,  0,  0,  0,  0,  0,  0,  0,  0,
  ],
  N: [
     4,  8, 16, 12,  4, 12, 16,  8,  4,
     4, 10, 28, 16,  8, 16, 28, 10,  4,
    12, 18, 24, 28, 22, 28, 24, 18, 12,
    10, 24, 22, 28, 26, 28, 22, 24, 10,
     8, 18, 20, 24, 20, 24, 20, 18,  8,
     6, 16, 18, 22, 18, 22, 18, 16,  6,
     4, 12, 16, 14, 12, 14, 16, 12,  4,
     2,  8, 14, 12,  6, 12, 14,  8,  2,
     0,  4,  8,  8, -8,  8,  8,  4,  0,
    -4, -2,  4,  4, -4,  4,  4, -2, -4,
  ],
  R: [
    14, 14, 12, 18, 16, 18, 12, 14, 14,
    16, 20, 18, 24, 26, 24, 18, 20, 16,
    12, 16, 14, 20, 20, 20, 14, 16, 12,
    12, 18, 16, 22, 22, 22, 16, 18, 12,
    12, 22, 18, 24, 24, 24, 18, 22, 12,
    10, 18, 14, 20, 20, 20, 14, 18, 10,
     8, 14, 10, 16, 14, 16, 10, 14,  8,
     6, 12,  8, 14, 12, 14,  8, 12,  6,
     8, 12,  8, 14,  6, 14,  8, 12,  8,
    -2, 10,  6, 12,  4, 12,  6, 10, -2,
  ],
  C: [
     6,  4,  0,-10,-12,-10,  0,  4,  6,
     4,  4,  0, -4,-14, -4,  0,  4,  4,
     4,  6,  4,  0, 10,  0,  4,  6,  4,
     2,  6,  6,  8, 14,  8,  6,  6,  2,
     2,  6,  8, 10, 16, 10,  8,  6,  2,
     4,  6,  8,  8, 14,  8,  8,  6,  4,
     0,  4,  4,  6, 10,  6,  4,  4,  0,
     2,  2,  8,  4, 14,  4,  8,  2,  2,
     0,  2,  2,  4,  4,  4,  2,  2,  0,
     0, -2,  2,  4,  4,  4,  2, -2,  0,
  ],
  B: [
    0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0,
    0,0,6,0,0,0,6,0,0, 0,0,0,0,0,0,0,0,0, 4,0,0,0,14,0,0,0,4, 0,0,0,0,0,0,0,0,0, 0,0,4,0,0,0,4,0,0,
  ],
  A: [
    0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,4,0,4,0,0,0, 0,0,0,0,14,0,0,0,0, 0,0,0,4,0,4,0,0,0,
  ],
  K: [
    0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0,
    0,0,0,0,0,0,0,0,0, 0,0,0,0,0,0,0,0,0, 0,0,0,-8,-8,-8,0,0,0, 0,0,0,-2,2,-2,0,0,0, 0,0,0,4,12,4,0,0,0,
  ],
};

// 10 Classical Chinese Xiangqi Opening Playbooks (Red & Black responses)
const XIANGQI_BOOK_LINES = [
  // 1. Trung Pháo Trực Xe đối Bình Phong Mã (Central Cannon vs Screen Horses)
  [['H3','E3'], ['H10','G8'], ['H1','G3'], ['I10','H10'], ['I1','H1'], ['B10','C8'], ['G4','G5'], ['G7','G6'], ['B1','C3'], ['B8','B4']],
  // 2. Trung Pháo đối Phản Cung Mã (Central Cannon vs Sandwich Horse)
  [['H3','E3'], ['B10','C8'], ['H1','G3'], ['H8','F8'], ['I1','H1'], ['H10','G8'], ['C4','C5'], ['A10','B10']],
  // 3. Thuận Pháo Trực Xe đối Hoành Xe (Same-Direction Cannons)
  [['H3','E3'], ['B8','E8'], ['H1','G3'], ['H10','G8'], ['I1','H1'], ['I10','I9'], ['B1','C3'], ['I9','D9']],
  // 4. Nghịch Pháo Cuộc (Opposite-Direction Cannons)
  [['H3','E3'], ['H8','E8'], ['H1','G3'], ['B10','C8'], ['I1','H1'], ['A10','B10'], ['C4','C5'], ['H10','G8']],
  // 5. Tiên Nhân Chỉ Lộ đối Liễm Pháo (Immortal's Guide vs Counter-Cannon)
  [['G4','G5'], ['B8','D8'], ['H1','G3'], ['H10','G8'], ['H3','E3'], ['B10','C8'], ['I1','H1'], ['I10','H10']],
  // 6. Tiên Nhân Chỉ Lộ đối Tốt Để Pháo
  [['C4','C5'], ['H8','G8'], ['B1','C3'], ['B10','C8'], ['H3','E3'], ['H10','G8'], ['H1','G3'], ['I10','H10']],
  // 7. Phi Tượng Cuộc đối Tả Trung Pháo (Elephant Opening)
  [['G1','E3'], ['B8','E8'], ['H1','G3'], ['H10','G8'], ['G4','G5'], ['B10','C8'], ['I1','H1'], ['I10','H10']],
  // 8. Quá Cung Pháo đối Khởi Mã (Cross-Palace Cannon)
  [['H3','D3'], ['H10','G8'], ['H1','G3'], ['I10','H10'], ['I1','H1'], ['B10','C8'], ['B1','C3'], ['C7','C6']],
  // 9. Trung Pháo Cấp Tấn Trung Binh (Rapid Central Pawn Attack)
  [['B3','E3'], ['B10','C8'], ['B1','C3'], ['H10','G8'], ['A1','B1'], ['A10','B10'], ['E4','E5'], ['C7','C6']],
  // 10. Khởi Mã Cuộc (Knight Opening)
  [['H1','G3'], ['G7','G6'], ['H3','F3'], ['H10','G8'], ['G4','G5'], ['B10','C8'], ['I1','H1'], ['G10','E8']],
];

export function lookupXiangqiBook(game) {
  const history = game.moves || [];
  if (history.length >= 10) return null;
  const played = history.map(m => `${m.from}:${m.to}`);
  const candidates = [];
  for (const line of XIANGQI_BOOK_LINES) {
    if (line.length <= played.length) continue;
    const encoded = line.map(([f, t]) => `${xSq(f)}:${xSq(t)}`);
    if (played.every((mv, idx) => encoded[idx] === mv)) {
      const [from, to] = line[played.length].map(xSq);
      candidates.push({ from, to });
    }
  }
  if (!candidates.length) return null;
  return candidates[selectVariant(`${game.id}:${history.length}`, candidates.length)];
}

// ============================================================================
// 3. CARO / GOMOKU: Renju / Gomoku Tactical Playbooks around Center (112)
// ============================================================================
// Relative (dr, dc) offsets from the first stone on the board (typically center 7,7 = 112)
const CARO_FORMATIONS = [
  // Hoa Nguyệt (Kagetsu): Direct + Diagonal + Cross
  [[0, 0], [-1, 1], [0, 1], [-1, 0], [1, 1], [-1, -1]],
  // Phố Nguyệt (Getsu): Diagonal Star + Wing
  [[0, 0], [-1, -1], [-1, 1], [0, -1], [-2, 0], [1, 1]],
  // Hằng Tinh (Kosei): Diagonal + Knight Jump
  [[0, 0], [1, 1], [-1, 1], [0, 1], [1, -1], [-1, 0]],
  // Thụy Tinh (Suisei): Orthogonal Sword
  [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1]],
  // Vân Nguyệt (Ungetsu): Flank Attack
  [[0, 0], [0, 1], [1, 1], [1, 0], [-1, 1], [0, -1]],
  // Kiếm Trận (Ken): Spearhead
  [[0, 0], [1, -1], [1, 0], [0, -1], [1, 1], [2, -1]],
];

export function lookupCaroBook(game) {
  const history = game.moves || [];
  const board = game.board;
  const stoneCount = board.filter(Boolean).length;
  if (stoneCount === 0) return { from: null, to: 112 }; // H8 center
  if (stoneCount !== history.length || stoneCount >= 5) return null;

  const anchor = history[0].to;
  const ar = Math.floor(anchor / 15);
  const ac = anchor % 15;
  if (ar < 3 || ar > 11 || ac < 3 || ac > 11) return null;

  const formation = CARO_FORMATIONS[selectVariant(`${game.id}:${stoneCount}`, CARO_FORMATIONS.length)];
  for (let i = 1; i < formation.length; i++) {
    const [dr, dc] = formation[i];
    const r = ar + dr;
    const c = ac + dc;
    const to = r * 15 + c;
    if (r >= 0 && r < 15 && c >= 0 && c < 15 && !board[to]) {
      return { from: null, to };
    }
  }
  return null;
}

// ============================================================================
// 4. REVERSI / OTHELLO: Edax Positional Matrix & Tiger/Rose/Diagonal Book
// ============================================================================
export const EDAX_REVERSI_WEIGHTS = [
  120, -24,  20,   8,   8,  20, -24, 120,
  -24, -48,  -5,  -4,  -4,  -5, -48, -24,
   20,  -5,  15,   4,   4,  15,  -5,  20,
    8,  -4,   4,   2,   2,   4,  -4,   8,
    8,  -4,   4,   2,   2,   4,  -4,   8,
   20,  -5,  15,   4,   4,  15,  -5,  20,
  -24, -48,  -5,  -4,  -4,  -5, -48, -24,
  120, -24,  20,   8,   8,  20, -24, 120,
];

const REVERSI_BOOK_LINES = [
  // Tiger Opening: d3 (19), c3 (18), c4 (26), c5 (34), b4 (25)
  [19, 18, 26, 34, 25, 42],
  // Rose Opening: f5 (37), f6 (45), e6 (44), f4 (29), e3 (20)
  [37, 45, 44, 29, 20, 19],
  // Perpendicular Opening: d3 (19), c5 (34), f6 (45), f5 (37), e6 (44)
  [19, 34, 45, 37, 44, 26],
  // Diagonal Opening: c4 (26), c3 (18), d3 (19), c5 (34), d6 (43)
  [26, 18, 19, 34, 43, 20],
];

export function lookupReversiBook(game, legalTargets) {
  const history = game.moves || [];
  if (history.length >= 6) return null;
  const played = history.map(m => m.to);
  const candidates = [];
  for (const line of REVERSI_BOOK_LINES) {
    if (line.length <= played.length) continue;
    if (played.every((t, idx) => line[idx] === t)) {
      const nextTo = line[played.length];
      if (legalTargets.some(m => m.to === nextTo)) {
        candidates.push({ from: null, to: nextTo });
      }
    }
  }
  if (!candidates.length) return null;
  return candidates[selectVariant(`${game.id}:${history.length}`, candidates.length)];
}

// ============================================================================
// 5. GO 9x9: Fuseki Opening Playbooks (Tengen, Hoshi, Komoku, San-San)
// ============================================================================
const GO_FUSEKI_PLANS = [
  // Plan 1: Tengen + 4 Hoshi Star Points (E5, C3, G7, C7, G3)
  [40, 20, 60, 24, 56, 42, 38, 22, 58],
  // Plan 2: Diagonal Star & Komoku (C3, G7, G3, C7, E5)
  [60, 20, 24, 56, 40, 30, 50, 32, 48],
  // Plan 3: High Influence (E5, E7, E3, C5, G5)
  [40, 22, 58, 38, 42, 20, 60, 24, 56],
];

export function lookupGoFuseki(game, legalMovesList) {
  const history = game.moves || [];
  if (history.length >= 5) return null;
  const plan = GO_FUSEKI_PLANS[selectVariant(`${game.id}:${history.length}`, GO_FUSEKI_PLANS.length)];
  for (const target of plan) {
    const found = legalMovesList.find(m => m.to === target);
    if (found) return found;
  }
  return null;
}

// ============================================================================
// 6. CHECKERS: Classical Draughts Opening Playbooks
// ============================================================================
const CHECKERS_BOOK_LINES = [
  // 1. Old Fourteenth: 41->32, 22->31, 45->36, 18->27
  [[41, 32], [22, 31], [45, 36], [18, 27], [43, 34]],
  // 2. Single Corner: 41->34, 22->29, 46->37, 18->25
  [[41, 34], [22, 29], [46, 37], [18, 25], [43, 36]],
  // 3. Cross Opening: 41->34, 20->27, 45->36, 16->25
  [[41, 34], [20, 27], [45, 36], [16, 25], [48, 41]],
  // 4. Double Corner: 45->36, 22->29, 41->34, 18->25
  [[45, 36], [22, 29], [41, 34], [18, 25], [52, 45]],
];

export function lookupCheckersBook(game, legalMovesList) {
  const history = game.moves || [];
  if (history.length >= 5 || game.forcedFrom != null) return null;
  const played = history.map(m => `${m.from}:${m.to}`);
  const candidates = [];
  for (const line of CHECKERS_BOOK_LINES) {
    if (line.length <= played.length) continue;
    if (played.every((mv, idx) => `${line[idx][0]}:${line[idx][1]}` === mv)) {
      const [from, to] = line[played.length];
      const match = legalMovesList.find(m => m.from === from && m.to === to);
      if (match) candidates.push(match);
    }
  }
  if (!candidates.length) return null;
  return candidates[selectVariant(`${game.id}:${history.length}`, candidates.length)];
}
