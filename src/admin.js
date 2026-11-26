import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { GameError } from './game.js';
import { sessionFor, validName } from './auth.js';
import { seats } from './room-game.js';

const uuid = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new GameError('Mã không hợp lệ.');
  return value;
};
const text = (value, max, label) => {
  if (typeof value !== 'string' || value.length > max) throw new GameError(`${label} không hợp lệ (tối đa ${max} ký tự).`);
  return value.trim();
};
export async function siteSettings(db) {
  const { rows } = await db.query('SELECT announcement, registration_enabled, rooms_enabled, updated_at FROM site_settings WHERE id=1');
  return rows[0];
}
export async function audit(client, actor, action, target, details) {
  await client.query('INSERT INTO admin_audit(id,actor_id,action,target,details,created_at) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), actor, action, target, JSON.stringify(details), Date.now()]);
}
export function adminRouter({ db, required, rooms, io, online }) {
  const router = Router();
  router.use(required, (req, _res, next) => {
    if (!req.user.account_id || !req.user.is_admin) return next(new GameError('Chỉ quản trị viên được truy cập.', 403));
    next();
  });
  // Serialize management writes, then recheck authorization inside the transaction.
  const mutate = (req, work) => db.transaction(async client => {
    await client.query('SELECT id FROM site_settings WHERE id=1 FOR UPDATE');
    const actor = await sessionFor(client, req);
    if (!actor?.is_admin || !actor.account_id) throw new GameError('Quyền quản trị hoặc phiên đã hết hạn.', 403);
    return work(client, actor);
  });
  router.get('/overview', async (_req, res) => {
    const { rows } = await db.query(`SELECT
      (SELECT count(*)::int FROM players) AS players,
      (SELECT count(*)::int FROM players WHERE account_id IS NOT NULL) AS accounts,
      (SELECT count(*)::int FROM players WHERE suspended_at IS NOT NULL) AS suspended,
      (SELECT count(*)::int FROM rooms) AS rooms,
      (SELECT count(*)::int FROM rooms WHERE state->'game'->>'phase'='playing') AS playing,
      (SELECT count(*)::int FROM matches) AS matches,
      (SELECT count(*)::int FROM practice_games) AS practice,
      (SELECT count(*)::int FROM reports WHERE status IN ('open','in_progress')) AS reports`);
    const activity = await db.query(`SELECT to_char(to_timestamp(finished_at/1000.0) AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS day, count(*)::int AS matches
      FROM matches WHERE finished_at >= $1 GROUP BY day ORDER BY day`, [Date.now() - 14 * 86400000]);
    res.json({ stats: { ...rows[0], online: new Set([...io.sockets.sockets.values()].map(s => s.data.user.id)).size }, activity: activity.rows, system: { database: db.kind, uptime: Math.floor(process.uptime()), now: Date.now() } });
  });
  router.get('/settings', async (_req, res) => res.json({ settings: await siteSettings(db) }));
  router.patch('/settings', async (req, res) => {
    const announcement = text(req.body.announcement, 1000, 'Thông báo');
    const { registration_enabled: registration, rooms_enabled: newRooms } = req.body;
    if (typeof registration !== 'boolean' || typeof newRooms !== 'boolean') throw new GameError('Cấu hình bật/tắt không hợp lệ.');
    await mutate(req, async (client, actor) => {
      const before = await siteSettings(client);
      await client.query('UPDATE site_settings SET announcement=$1,registration_enabled=$2,rooms_enabled=$3,updated_at=$4 WHERE id=1', [announcement, registration, newRooms, Date.now()]);
      await audit(client, actor.id, 'settings.update', 'site', { before, after: { announcement, registration_enabled: registration, rooms_enabled: newRooms } });
    });
    res.json({ settings: await siteSettings(db) });
  });
  router.get('/:collection', async (req, res) => {
    const page = Number(req.query.page ?? 1), size = 20;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new GameError('Trang không hợp lệ.');
    const q = text(req.query.q ?? '', 100, 'Tìm kiếm');
    const status = text(req.query.status ?? '', 20, 'Trạng thái');
    const values = [], conditions = [];
    const param = value => { values.push(value); return `$${values.length}`; };
    let from, projection, order;
    switch (req.params.collection) {
      case 'users':
        from = 'players p LEFT JOIN accounts a ON a.id=p.account_id';
        projection = `p.id,p.display_name,p.account_id IS NOT NULL AS account,a.email,p.is_admin,p.suspended_at,p.suspension_reason,p.created_at,
          (SELECT count(*)::int FROM sessions s WHERE s.player_id=p.id AND s.expires_at>${param(Date.now())}) AS sessions`;
        order = 'p.created_at DESC,p.id';
        if (q) { const p = param(`%${q}%`); conditions.push(`(p.display_name ILIKE ${p} OR a.email ILIKE ${p} OR p.id::text ILIKE ${p})`); }
        if (status === 'admin') conditions.push('p.is_admin=TRUE');
        else if (status === 'suspended') conditions.push('p.suspended_at IS NOT NULL');
        else if (status === 'account') conditions.push('p.account_id IS NOT NULL');
        else if (status) throw new GameError('Bộ lọc không hợp lệ.');
        break;
      case 'reports':
        from = 'reports r JOIN players p ON p.id=r.player_id';
        projection = 'r.id,r.player_id,p.display_name,r.room_id,r.body,r.status,r.admin_note,r.created_at,r.updated_at'; order = 'r.created_at DESC,r.id';
        if (q) { const p = param(`%${q}%`); conditions.push(`(r.body ILIKE ${p} OR p.display_name ILIKE ${p} OR r.room_id ILIKE ${p})`); }
        if (status) { if (!['open','in_progress','resolved','dismissed'].includes(status)) throw new GameError('Bộ lọc không hợp lệ.'); conditions.push(`r.status=${param(status)}`); }
        break;
      case 'rooms':
        from = 'rooms r'; order = 'r.updated_at DESC,r.id';
        projection = `r.id,r.state->>'kind' AS kind,r.state->'game'->>'phase' AS phase,r.state->'owner'->>'name' AS owner,r.state->'guest'->>'name' AS guest,
          COALESCE((r.state->>'ranked')::boolean,FALSE) AS ranked,r.created_at,r.updated_at`;
        if (q) { const p = param(`%${q}%`); conditions.push(`(r.id ILIKE ${p} OR r.state->'owner'->>'name' ILIKE ${p} OR r.state->'guest'->>'name' ILIKE ${p})`); }
        if (status) { if (!['waiting','playing','finished'].includes(status)) throw new GameError('Bộ lọc không hợp lệ.'); conditions.push(`r.state->'game'->>'phase'=${param(status)}`); }
        break;
      case 'matches':
        from = 'matches m'; order = 'm.finished_at DESC,m.id';
        projection = `m.id,m.room_id,m.snapshot->>'kind' AS kind,m.snapshot->'owner'->>'name' AS owner,m.snapshot->'guest'->>'name' AS guest,
          m.snapshot->'game'->'result' AS result,m.snapshot->'game'->'ratingChanges' AS rating_changes,m.finished_at`;
        if (q) { const p = param(`%${q}%`); conditions.push(`(m.id::text ILIKE ${p} OR m.room_id ILIKE ${p} OR m.snapshot->'owner'->>'name' ILIKE ${p} OR m.snapshot->'guest'->>'name' ILIKE ${p})`); }
        break;
      case 'practice':
        from = 'practice_games g JOIN players p ON p.id=g.player_id'; order = 'g.updated_at DESC,g.id';
        projection = `g.id,p.display_name,g.kind,g.state->>'phase' AS phase,g.state->>'difficulty' AS difficulty,COALESCE((g.state->>'ranked')::boolean,FALSE) AS ranked,g.created_at,g.updated_at`;
        if (q) { const p = param(`%${q}%`); conditions.push(`(g.id::text ILIKE ${p} OR p.display_name ILIKE ${p} OR g.kind ILIKE ${p})`); }
        if (status) { if (!['playing','finished'].includes(status)) throw new GameError('Bộ lọc không hợp lệ.'); conditions.push(`g.state->>'phase'=${param(status)}`); }
        break;
      case 'audit':
        from = 'admin_audit a LEFT JOIN players p ON p.id=a.actor_id'; order = 'a.created_at DESC,a.id';
        projection = 'a.id,a.actor_id,p.display_name,a.action,a.target,a.details,a.created_at';
        if (q) { const p = param(`%${q}%`); conditions.push(`(a.action ILIKE ${p} OR a.target ILIKE ${p} OR p.display_name ILIKE ${p})`); }
        break;
      default: throw new GameError('Không tìm thấy mục quản trị.', 404);
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    // Count uses the same bound parameters, including the sessions projection parameter.
    const count = await db.query(`SELECT count(*)::int AS total FROM (SELECT ${projection} FROM ${from}${where}) entries`, values);
    const rows = await db.query(`SELECT ${projection} FROM ${from}${where} ORDER BY ${order} LIMIT ${size} OFFSET ${(page - 1) * size}`, values);
    res.json({ items: req.params.collection === 'users' ? rows.rows.map(p => ({ ...p, online: online(p.id) })) : rows.rows, total: count.rows[0].total, page, size });
  });
  router.patch('/users/:id', async (req, res) => {
    const id = uuid(req.params.id), body = req.body;
    if (!Object.keys(body).length || Object.keys(body).some(k => !['name','is_admin','suspended','reason'].includes(k))) throw new GameError('Thay đổi người dùng không hợp lệ.');
    const disconnect = await mutate(req, async (client, actor) => {
      const { rows } = await client.query('SELECT id,account_id,display_name,is_admin,suspended_at,suspension_reason FROM players WHERE id=$1 FOR UPDATE', [id]);
      const p = rows[0]; if (!p) throw new GameError('Không tìm thấy người dùng.', 404);
      const name = body.name === undefined ? p.display_name : validName(body.name);
      const admin = body.is_admin ?? p.is_admin, suspended = body.suspended ?? (p.suspended_at !== null);
      if (typeof admin !== 'boolean' || typeof suspended !== 'boolean') throw new GameError('Quyền hoặc trạng thái không hợp lệ.');
      if (admin && (!p.account_id || suspended)) throw new GameError('Admin phải là tài khoản đã đăng ký và đang hoạt động.');
      if (id === actor.id && (suspended || !admin)) throw new GameError('Không thể tự khóa hoặc gỡ quyền của chính mình.', 409);
      const reason = suspended ? text(body.reason ?? p.suspension_reason, 500, 'Lý do khóa') : '';
      if (suspended && reason.length < 5) throw new GameError('Lý do khóa cần ít nhất 5 ký tự.');
      await client.query('UPDATE players SET display_name=$1,is_admin=$2,suspended_at=$3,suspension_reason=$4 WHERE id=$5', [name, admin, suspended ? p.suspended_at || Date.now() : null, reason, id]);
      if (suspended || (p.is_admin && !admin)) {
        await client.query('DELETE FROM sessions WHERE player_id=$1', [id]);
        await client.query('DELETE FROM rank_queue WHERE player_id=$1', [id]);
      }
      await audit(client, actor.id, 'user.update', id, { before: p, after: { name, is_admin: admin, suspended, reason } });
      return suspended || (p.is_admin && !admin);
    });
    if (disconnect) io.in(`player:${id}`).disconnectSockets(true);
    res.json({ ok: true });
  });
  router.post('/users/:id/revoke-sessions', async (req, res) => {
    const id = uuid(req.params.id);
    await mutate(req, async (client, actor) => {
      const target = await client.query('SELECT id FROM players WHERE id=$1', [id]);
      if (!target.rows.length) throw new GameError('Không tìm thấy người dùng.', 404);
      await client.query('DELETE FROM sessions WHERE player_id=$1', [id]);
      await client.query('DELETE FROM rank_queue WHERE player_id=$1', [id]);
      await audit(client, actor.id, 'user.revoke_sessions', id, {});
    });
    io.in(`player:${id}`).disconnectSockets(true);
    res.json({ ok: true });
  });
  router.patch('/reports/:id', async (req, res) => {
    const id = uuid(req.params.id), { status } = req.body, note = text(req.body.admin_note, 2000, 'Ghi chú');
    if (!['open','in_progress','resolved','dismissed'].includes(status)) throw new GameError('Trạng thái không hợp lệ.');
    await mutate(req, async (client, actor) => {
      const { rows } = await client.query('SELECT status,admin_note FROM reports WHERE id=$1 FOR UPDATE', [id]);
      if (!rows.length) throw new GameError('Không tìm thấy góp ý.', 404);
      await client.query('UPDATE reports SET status=$1,admin_note=$2,updated_at=$3 WHERE id=$4', [status, note, Date.now(), id]);
      await audit(client, actor.id, 'report.update', id, { before: rows[0], after: { status, admin_note: note } });
    });
    res.json({ ok: true });
  });
  router.post('/rooms/:id/close', async (req, res) => {
    const id = req.params.id, reason = text(req.body.reason, 500, 'Lý do hủy');
    if (!/^[A-F0-9]{8}$/.test(id) || reason.length < 5) throw new GameError('Mã phòng hoặc lý do hủy không hợp lệ.');
    const memberIds = await mutate(req, async (client, actor) => {
      const room = await rooms.read(id, client, true);
      await client.query('DELETE FROM rooms WHERE id=$1', [id]);
      const members = seats(room).map(s => s.id);
      await audit(client, actor.id, 'room.close', id, { reason, kind: room.kind, phase: room.game.phase, ranked: !!room.ranked, members });
      return members;
    });
    clearTimeout(rooms.timers.get(id)); rooms.timers.delete(id);
    for (const playerId of memberIds) io.to(`player:${playerId}`).emit('room-closed', { id, reason: 'admin', message: `Quản trị viên đã hủy phòng: ${reason}` });
    res.json({ ok: true });
  });
  return router;
}
