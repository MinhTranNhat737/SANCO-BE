import { randomUUID, randomBytes } from 'node:crypto';
import { GameError, newGame, other, applyAction, settleTimeout, seatOf, publicRoom, KINDS, boardSide, seats } from './room-game.js';
import {PARTY_KINDS,PARTY_SIDES} from './party-games.js';
import { digest, secret } from './auth.js';

export const ROOM_INACTIVITY_MS = 5 * 60 * 1000;

// Strip replay arrays in SQL, before they enter Node or travel to the lobby.
const summaryProjection = column => `jsonb_set(${column}, '{game}', (${column}->'game') - ARRAY['board','initialBoard','moves','repetitions','seenPositions','party','initialParty','legal'] || jsonb_build_object('moveCount',jsonb_array_length(${column}->'game'->'moves')))`;

export class RoomService {
  constructor(db, onChange = () => {}, online = () => false, options = {}) {
    this.db = db;
    this.onChange = onChange;
    this.online = online;
    this.inactivityMs = Number.isFinite(options.inactivityMs) ? options.inactivityMs : ROOM_INACTIVITY_MS;
    this.onDelete = options.onDelete || (() => {});
    this.timers = new Map();
    this.sweepTimer = null;
    this.closed = false;
  }
  async start() {
    await this.pruneInactive();
    const { rows } = await this.db.query("SELECT id FROM rooms WHERE state->'game'->>'phase' = 'playing'");
    for (const { id } of rows) await this.expire(id).catch(() => {});
  }
  view(room, actor) { return publicRoom(room, actor, Date.now(), this.online); }
  async read(id, client = this.db, lock = false) {
    const { rows } = await client.query(`SELECT state, updated_at FROM rooms WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!rows[0]) throw new GameError('Không tìm thấy phòng. Kiểm tra lại liên kết mời.', 404);
    const room = rows[0].state;
    room.updatedAt = Number(rows[0].updated_at);
    if(room.players){room.owner=room.players.find(s=>s.id===room.owner.id);room.guest=room.guest?room.players.find(s=>s.id===room.guest.id):null;}
    return room;
  }
  async cancelInactiveRoom(id, cutoff) {
    const deleted = await this.db.transaction(async client => {
      const { rows } = await client.query('SELECT state, updated_at FROM rooms WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0] || Number(rows[0].updated_at) > cutoff) return null;
      const room = rows[0].state;
      const memberIds = [...new Set([room.owner?.id, room.guest?.id, ...seats(room).map(s => s.id)].filter(Boolean))];
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      await client.query('DELETE FROM rooms WHERE id = $1', [id]);
      return { id, memberIds, room };
    });
    if (deleted && !this.closed) this.onDelete(id, deleted.memberIds, deleted.room);
    return deleted;
  }
  async ensureActive(id) {
    if (this.closed || this.inactivityMs <= 0) return;
    const cutoff = Date.now() - this.inactivityMs;
    const deleted = await this.cancelInactiveRoom(id, cutoff);
    if (deleted) {
      await this.scheduleSweep();
      throw new GameError('Bàn đã bị hủy và xóa do không hoạt động quá 5 phút.', 410);
    }
  }
  async pruneInactive(now = Date.now()) {
    if (this.closed || this.inactivityMs <= 0) return [];
    const cutoff = now - this.inactivityMs;
    const { rows } = await this.db.query('SELECT id FROM rooms WHERE updated_at <= $1', [cutoff]);
    const removed = [];
    for (const row of rows) {
      const out = await this.cancelInactiveRoom(row.id, cutoff);
      if (out) removed.push(out.id);
    }
    await this.scheduleSweep();
    return removed;
  }
  async scheduleSweep() {
    clearTimeout(this.sweepTimer);
    this.sweepTimer = null;
    if (this.closed || this.inactivityMs <= 0) return;
    try {
      const { rows } = await this.db.query('SELECT MIN(updated_at) AS oldest FROM rooms');
      if (this.closed || !rows[0]?.oldest) return;
      const delay = Math.max(10, Number(rows[0].oldest) + this.inactivityMs - Date.now());
      this.sweepTimer = setTimeout(() => { this.pruneInactive().catch(error => console.error('Room inactivity sweep failed:', error.message)); }, Math.min(delay, 2147483647));
      this.sweepTimer.unref();
    } catch (error) {
      if (!this.closed) console.error('Room sweep schedule failed:', error.message);
    }
  }
  async persist(client, room) {
    const now = Date.now();
    room.version += 1;
    room.updatedAt = now;
    await client.query('UPDATE rooms SET state=$1, version=$2, guest_id=$3, updated_at=$4 WHERE id=$5', [JSON.stringify(room), room.version, room.guest?.id || null, now, room.id]);
    if (room.game.phase === 'finished' && room.guest) await client.query(`INSERT INTO matches(id,room_id,owner_id,guest_id,rules_version,snapshot,finished_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,
    [room.game.id, room.id, room.owner.id, room.guest.id, room.game.rules, JSON.stringify(room), room.game.result.at]);
    if(room.players&&room.game.phase==='finished')for(const s of room.players)await client.query('INSERT INTO match_members(match_id,player_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[room.game.id,s.id]);
  }
  changed(room) { if (!this.closed) { this.schedule(room); void this.scheduleSweep(); this.onChange(room); } }
  schedule(room) {
    clearTimeout(this.timers.get(room.id)); this.timers.delete(room.id);
    if (this.closed || room.game.phase !== 'playing') return;
    const delay = Math.max(1, room.game.turnStartedAt + room.game.remaining[room.game.turn] - Date.now());
    const timer = setTimeout(() => this.expire(room.id).catch(error => { console.error('Clock persistence failed:', error.message); if (!this.closed) { const retry = setTimeout(() => this.expire(room.id).catch(console.error), 1000); retry.unref(); this.timers.set(room.id, retry); } }), Math.min(delay, 2147483647));
    timer.unref(); this.timers.set(room.id, timer);
  }
  async expire(id) {
    let changed = false;
    const room = await this.db.transaction(async client => {
      const { rows } = await client.query('SELECT state FROM rooms WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) return null;
      const room = rows[0].state;
      if(room.players){room.owner=room.players.find(s=>s.id===room.owner.id);room.guest=room.guest?room.players.find(s=>s.id===room.guest.id):null;}
      if (settleTimeout(room, Date.now())) { await this.persist(client, room); changed = true; }
      return room;
    });
    if (!room) return null;
    if (changed) this.changed(room); else this.schedule(room);
    return room;
  }
  async create(user, minutes, kind='caro', side='random', capacity=2) {
    if(!KINDS.includes(kind))throw new GameError('Môn cờ không hợp lệ.');
    if(!['first','second','random'].includes(side))throw new GameError('Bên quân không hợp lệ.');
    if(!Number.isInteger(capacity)||capacity<2||capacity>(PARTY_KINDS.includes(kind)?4:2))throw new GameError('Số người không hợp lệ.');
    if (!(kind==='monopoly'?[3,5,10,15,30,60,120]:[3,5,10,15]).includes(minutes)) throw new GameError('Chọn thời gian 3, 5, 10 hoặc 15 phút.');
    await this.pruneInactive();
    const { rows } = await this.db.query("SELECT count(*)::integer AS n FROM rooms WHERE owner_id=$1 AND state->'game'->>'phase'='waiting'", [user.id]);
    if (rows[0].n >= 10) throw new GameError('Bạn đã có 10 phòng chờ. Hãy dùng một phòng đang có.', 429);
    const token = secret(), now = Date.now(), mark = boardSide(kind,side==='random'?!!(randomBytes(1)[0]%2):side==='first');
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = randomBytes(4).toString('hex').toUpperCase();
      const room = { id, kind, version: 0, duration: minutes * 60000, createdAt: now, updatedAt: now,
        owner: { id: user.id, name: user.display_name, mark, ready: false, rematch: false }, guest: null,
        inviteHash: digest(token), inviteExpiresAt: now + 86400000, drawOffer: null, game: newGame(minutes * 60000, randomUUID(),kind,capacity) };
      if(PARTY_KINDS.includes(kind)){room.capacity=capacity;room.players=[room.owner];}
      const out = await this.db.query('INSERT INTO rooms(id,owner_id,state,created_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT(id) DO NOTHING RETURNING id', [id, user.id, JSON.stringify(room), now]);
      if (out.rows.length) {
        void this.scheduleSweep();
        return { room: this.view(room, user.id), token };
      }
    }
    throw new GameError('Chưa tạo được phòng. Vui lòng thử lại.', 503);
  }
  async get(id, actor) {
    // Authorize before processing expiry or exposing any metadata; normal reads take no write transaction.
    const room = await this.read(id);
    seatOf(room, actor);
    if (this.inactivityMs > 0 && Date.now() - room.updatedAt >= this.inactivityMs) {
      await this.ensureActive(id);
    }
    const g=room.game;
    // Ordinary reads do not acquire a write lock or reset a clock timer.
    if(g.phase==='playing'&&g.turnStartedAt!==null&&Date.now()>=g.turnStartedAt+g.remaining[g.turn])return this.view(await this.expire(id),actor);
    return this.view(room,actor);
  }
  async join(id, actor, token) {
    await this.ensureActive(id);
    const room = await this.db.transaction(async client => {
      const room = await this.read(id, client, true);
      if (seats(room).some(s=>s.id===actor.id)) return room;
      if (typeof token !== 'string' || digest(token) !== room.inviteHash || Date.now() >= room.inviteExpiresAt) throw new GameError('Lời mời không hợp lệ hoặc đã hết hạn. Hãy xin bạn một lời mời mới.', 403);
      if (seats(room).length>=(room.capacity||2)) throw new GameError('Phòng đã đủ người.', 409);
      if (room.game.phase !== 'waiting') throw new GameError('Phòng không còn nhận người chơi.', 409);
      const next={id:actor.id,name:actor.display_name,mark:room.players?PARTY_SIDES.slice(0,room.capacity).find(side=>!room.players.some(s=>s.mark===side)):other(room.owner.mark,room.kind),ready:false,rematch:false};
      if(room.players){room.players.push(next);if(!room.guest)room.guest=next;for(const s of room.players)s.ready=false;}else room.guest=next;
      if(room.players)for(const s of room.players)await client.query('INSERT INTO room_members(room_id,player_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[room.id,s.id]);
      room.owner.ready = false;
      await this.persist(client, room); return room;
    });
    this.changed(room); return this.view(room, actor.id);
  }
  async invite(id, actor) {
    await this.ensureActive(id);
    const token = secret();
    const room = await this.db.transaction(async client => {
      const room = await this.read(id, client, true);
      if (room.owner.id !== actor) throw new GameError('Chỉ chủ phòng có thể thay lời mời.', 403);
      room.inviteHash = digest(token); room.inviteExpiresAt = Date.now() + 86400000;
      await this.persist(client, room); return room;
    });
    this.changed(room); return { room: this.view(room, actor), token };
  }
  async act(id, actor, body) {
    const { actionId, version, action, cell, from=null, to, promotion,pass,command,details } = body;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actionId || '') || !Number.isInteger(version)) throw new GameError('Yêu cầu không hợp lệ. Hãy tải lại bàn cờ.');
    await this.ensureActive(id);
    const requestHash = digest(JSON.stringify({ version, action, cell, from, to, promotion,pass,command,details }));
    let stale = false;
    const room = await this.db.transaction(async client => {
      const room = await this.read(id, client, true);
      seatOf(room, actor);
      const { rows } = await client.query('SELECT request_hash FROM action_receipts WHERE room_id=$1 AND player_id=$2 AND action_id=$3', [id, actor, actionId]);
      if (rows[0]) {
        if (rows[0].request_hash !== requestHash) throw new GameError('Mã thao tác đã được dùng cho yêu cầu khác.', 409);
        return room;
      }
      const now = Date.now();
      // Expiry is committed even when the incoming move is too late.
      if (settleTimeout(room, now)) { await this.persist(client, room); stale = true; return room; }
      if (room.version !== version) throw new GameError('Bàn cờ vừa cập nhật. Hãy kiểm tra và thực hiện lại thao tác.', 409);
      applyAction(room, actor, action, { cell, from, to, promotion,pass,details,action:command }, now, randomUUID());
      await this.persist(client, room);
      await client.query('INSERT INTO action_receipts(room_id,player_id,action_id,request_hash,created_at) VALUES($1,$2,$3,$4,$5)', [id, actor, actionId, requestHash, now]);
      return room;
    });
    this.changed(room);
    if (stale) throw new GameError('Ván đã kết thúc vì hết giờ.', 409);
    return this.view(room, actor);
  }
  async mine(actor,summary=false) {
    await this.pruneInactive();
    const { rows } = await this.db.query(`SELECT ${summary?summaryProjection('state'):'state'} AS state FROM rooms WHERE owner_id=$1 OR guest_id=$1 OR EXISTS(SELECT 1 FROM room_members m WHERE m.room_id=rooms.id AND m.player_id=$1) ORDER BY updated_at DESC LIMIT 20`, [actor]);
    return rows.map(row => publicRoom(row.state,actor,Date.now(),this.online,summary));
  }
  async history(actor,summary=false) {
    const { rows } = await this.db.query(`SELECT ${summary?summaryProjection('snapshot'):'snapshot'} AS snapshot FROM matches WHERE owner_id=$1 OR guest_id=$1 OR EXISTS(SELECT 1 FROM match_members m WHERE m.match_id=matches.id AND m.player_id=$1) ORDER BY finished_at DESC LIMIT 30`, [actor]);
    return rows.map(row => publicRoom(row.snapshot,actor,Date.now(),this.online,summary));
  }
  async match(id, actor) {
    const { rows } = await this.db.query('SELECT snapshot FROM matches WHERE id=$1 AND (owner_id=$2 OR guest_id=$2 OR EXISTS(SELECT 1 FROM match_members m WHERE m.match_id=matches.id AND m.player_id=$2))', [id, actor]);
    if (!rows[0]) throw new GameError('Không tìm thấy ván hoặc bạn không có quyền xem.', 404);
    return this.view(rows[0].snapshot, actor);
  }
  close() { this.closed = true; clearTimeout(this.sweepTimer); this.sweepTimer = null; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
}
