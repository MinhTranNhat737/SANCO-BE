export const SIZE = 15;
export const RULES = 'caro-freestyle-v1';
export const other = mark => mark === 'X' ? 'O' : 'X';
export const coordinate = cell => `${'ABCDEFGHIJKLMNO'[cell % SIZE]}${Math.floor(cell / SIZE) + 1}`;
export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function newGame(duration, id) {
  return { id, rules: RULES, board: Array(225).fill(null), moves: [], phase: 'waiting', turn: 'X',
    remaining: { X: duration, O: duration }, turnStartedAt: null, result: null };
}
export function winningLine(board, cell) {
  const mark = board[cell];
  if (!mark) return [];
  const row = Math.floor(cell / SIZE), col = cell % SIZE;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [cell];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign, c = col + dc * sign;
      while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[r * SIZE + c] === mark) {
        if (sign === -1) line.unshift(r * SIZE + c); else line.push(r * SIZE + c);
        r += dr * sign; c += dc * sign;
      }
    }
    if (line.length >= 5) return line;
  }
  return [];
}
export function finish(game, winner, reason, now, line = []) {
  game.phase = 'finished';
  game.result = { winner, reason, line, at: now };
  game.turnStartedAt = null;
}
export function settleTimeout(room, now) {
  const g = room.game;
  if (g.phase !== 'playing' || g.turnStartedAt === null) return false;
  const deadline = g.turnStartedAt + g.remaining[g.turn];
  if (now < deadline) return false;
  g.remaining[g.turn] = 0;
  finish(g, other(g.turn), 'timeout', deadline);
  return true;
}
export function seatOf(room, actor) {
  const me = room.owner.id === actor ? room.owner : room.guest?.id === actor ? room.guest : null;
  if (!me) throw new GameError('Bạn chưa có quyền vào phòng này. Hãy mở liên kết mời.', 403);
  return me;
}
export function applyAction(room, actor, action, data, now, nextGameId) {
  const me = seatOf(room, actor), g = room.game;
  if (action === 'ready') {
    if (g.phase !== 'waiting') throw new GameError('Ván đã bắt đầu.', 409);
    me.ready = !me.ready;
    if (room.guest && room.owner.ready && room.guest.ready) { g.phase = 'playing'; g.turnStartedAt = now; }
    return;
  }
  if (action === 'rematch') {
    if (g.phase !== 'finished') throw new GameError('Chờ ván hiện tại kết thúc.', 409);
    me.rematch = !me.rematch;
    if (room.guest && room.owner.rematch && room.guest.rematch) {
      room.owner.mark = other(room.owner.mark); room.guest.mark = other(room.guest.mark);
      for (const s of [room.owner, room.guest]) { s.ready = false; s.rematch = false; }
      room.drawOffer = null; room.game = newGame(room.duration, nextGameId);
    }
    return;
  }
  if (g.phase !== 'playing') throw new GameError('Ván chưa bắt đầu hoặc đã kết thúc.', 409);
  const consumeTime = () => { g.remaining[g.turn] = Math.max(0, g.remaining[g.turn] - (now - g.turnStartedAt)); };
  if (action === 'resign') { consumeTime(); finish(g, other(me.mark), 'resign', now); return; }
  if (action === 'draw') {
    if (room.drawOffer === actor) throw new GameError('Bạn đã gửi lời mời hòa.');
    if (room.drawOffer) { consumeTime(); finish(g, null, 'agreement', now); }
    else room.drawOffer = actor;
    return;
  }
  if (action === 'decline') {
    if (!room.drawOffer || room.drawOffer === actor) throw new GameError('Không có lời mời hòa để từ chối.');
    room.drawOffer = null; return;
  }
  if (action !== 'move') throw new GameError('Thao tác không được hỗ trợ.');
  if (g.turn !== me.mark) throw new GameError('Chưa đến lượt bạn.', 409);
  const { cell } = data;
  if (!Number.isInteger(cell) || cell < 0 || cell >= 225) throw new GameError('Ô cờ không hợp lệ.');
  if (g.board[cell]) throw new GameError('Ô này đã có quân.', 409);
  consumeTime();
  g.board[cell] = me.mark;
  g.moves.push({ cell, mark: me.mark, at: now });
  if (room.drawOffer && room.drawOffer !== actor) room.drawOffer = null;
  const line = winningLine(g.board, cell);
  if (line.length) finish(g, me.mark, 'five', now, line);
  else if (g.moves.length === 225) finish(g, null, 'full', now);
  else { g.turn = other(g.turn); g.turnStartedAt = now; }
}
export function publicRoom(room, actor, now, online = () => false) {
  const me = seatOf(room, actor);
  const seat = s => ({ name: s.name, mark: s.mark, ready: s.ready, rematch: s.rematch, online: online(s.id) });
  return { id: room.id, version: room.version, duration: room.duration, createdAt: room.createdAt,
    inviteExpiresAt: room.inviteExpiresAt, owner: seat(room.owner), guest: room.guest ? seat(room.guest) : null,
    me: { role: room.owner.id === actor ? 'owner' : 'guest', mark: me.mark, ready: me.ready, rematch: me.rematch },
    drawOffer: room.drawOffer ? room.drawOffer === actor ? 'me' : 'opponent' : null,
    game: room.game, serverNow: now };
}
