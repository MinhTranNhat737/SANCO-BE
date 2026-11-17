// Basic Xiangqi movement and king-safety rules. Practice draw policy is explicit
// in practice-engine.js; this is not a WXF perpetual-chase adjudicator.
export const X_VALUES = { K: 20000, R: 900, C: 450, N: 420, B: 200, A: 200, P: 100 };
export const xOther = side => side === 'r' ? 'b' : 'r';
export function initialXiangqi() {
  const board = Array(90).fill(null), back = ['R','N','B','A','K','A','B','N','R'];
  for (let col = 0; col < 9; col++) { board[col] = 'b' + back[col]; board[81 + col] = 'r' + back[col]; }
  for (const col of [1, 7]) { board[18 + col] = 'bC'; board[63 + col] = 'rC'; }
  for (const col of [0, 2, 4, 6, 8]) { board[27 + col] = 'bP'; board[54 + col] = 'rP'; }
  return board;
}
const inside = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;
const palace = (r, c, side) => c >= 3 && c <= 5 && (side === 'r' ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
export function xPseudo(board, from) {
  const piece = board[from]; if (!piece) return [];
  const side = piece[0], type = piece[1], row = Math.floor(from / 9), col = from % 9, moves = [];
  const add = (r, c) => { if (inside(r,c) && board[r*9+c]?.[0] !== side) moves.push({from,to:r*9+c}); };
  if (type === 'R' || type === 'C') {
    for (const [dr, dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
      let screen = false;
      for (let r = row + dr, c = col + dc; inside(r,c); r += dr, c += dc) {
        const target = board[r*9+c];
        if (type === 'R') { if (target) { if (target[0] !== side) add(r,c); break; } add(r,c); }
        else if (!screen) { if (target) screen = true; else add(r,c); }
        else if (target) { if (target[0] !== side) add(r,c); break; }
      }
    }
  } else if (type === 'N') {
    for (const [dr,dc] of [[-2,-1],[-2,1],[2,-1],[2,1],[-1,-2],[1,-2],[-1,2],[1,2]]) {
      const legR = row + (Math.abs(dr) === 2 ? Math.sign(dr) : 0), legC = col + (Math.abs(dc) === 2 ? Math.sign(dc) : 0);
      if (inside(legR,legC) && !board[legR*9+legC]) add(row+dr,col+dc);
    }
  } else if (type === 'B') {
    for (const [dr,dc] of [[-2,-2],[-2,2],[2,-2],[2,2]]) {
      const r = row+dr, c = col+dc;
      if (inside(r,c) && (side==='r'?r>=5:r<=4) && !board[(row+dr/2)*9+col+dc/2]) add(r,c);
    }
  } else if (type === 'A') {
    for (const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) if (palace(row+dr,col+dc,side)) add(row+dr,col+dc);
  } else if (type === 'K') {
    for (const [dr,dc] of [[0,1],[0,-1],[1,0],[-1,0]]) if (palace(row+dr,col+dc,side)) add(row+dr,col+dc);
    // Flying generals are also attacks for king-safety calculations.
    for (const dr of [-1,1]) for (let r=row+dr;inside(r,col);r+=dr) { const target=board[r*9+col]; if (target) { if (target===xOther(side)+'K') add(r,col); break; } }
  } else if (type === 'P') {
    add(row + (side==='r'?-1:1), col);
    if (side==='r'?row<=4:row>=5) { add(row,col-1); add(row,col+1); }
  }
  return moves;
}
export function xInCheck(board, side) {
  const king = board.indexOf(side+'K'); if (king < 0) return true;
  for (let from=0;from<90;from++) if (board[from]?.[0]===xOther(side) && xPseudo(board,from).some(move=>move.to===king)) return true;
  return false;
}
export function xLegal(board, side) {
  const moves = [];
  for (let from=0;from<90;from++) if (board[from]?.[0]===side) for (const move of xPseudo(board,from)) {
    const target=board[move.to];
    if (target?.[1]==='K') continue;
    board[move.to]=board[from];board[from]=null;
    const safe=!xInCheck(board,side);
    board[from]=board[move.to];board[move.to]=target;
    if (safe) moves.push(move);
  }
  return moves;
}
