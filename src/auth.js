import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { GameError } from './game.js';
const scrypt = promisify(scryptCallback);
const sessionAge = 30 * 24 * 60 * 60 * 1000;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const validName = value => {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 30 || /[\u0000-\u001f\u007f<>]/.test(name)) throw new GameError('Tên hiển thị cần từ 2 đến 30 ký tự, không chứa ký tự đặc biệt.');
  return name;
};
export function credentials(body) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GameError('Địa chỉ email không hợp lệ.');
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw new GameError('Mật khẩu cần từ 10 đến 128 ký tự.');
  return { email, password };
}
export async function hashPassword(password) {
  const salt = secret();
  const key = await scrypt(password, salt, 64, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return `scrypt$65536$8$1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, salt, expected] = encoded.split('$');
  if (algorithm !== 'scrypt' || !expected) return false;
  const actual = await scrypt(password, salt, 64, { N: +n, r: +r, p: +p, maxmem: 128 * 1024 * 1024 });
  return timingSafeEqual(Buffer.from(expected, 'hex'), actual);
}
export function sessionToken(request) {
  const pair = (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sc_session='));
  return pair ? pair.slice('sc_session='.length) : '';
}
export async function sessionFor(db, request) {
  const token = sessionToken(request);
  if (!/^[\w-]{43}$/.test(token)) return null;
  const { rows } = await db.query(`SELECT p.id, p.display_name, p.account_id, a.email, s.token_hash, s.expires_at
    FROM sessions s JOIN players p ON p.id = s.player_id LEFT JOIN accounts a ON a.id = p.account_id
    WHERE s.token_hash = $1 AND s.expires_at > $2`, [digest(token), Date.now()]);
  return rows[0] || null;
}
export async function issueSession(db, response, playerId, previousHash, secure) {
  const token = secret(), now = Date.now();
  await db.query('INSERT INTO sessions(token_hash, player_id, expires_at, created_at) VALUES($1,$2,$3,$4)', [digest(token), playerId, now + sessionAge, now]);
  if (previousHash) await db.query('DELETE FROM sessions WHERE token_hash = $1', [previousHash]);
  response.cookie('sc_session', token, { httpOnly: true, sameSite: 'lax', secure, maxAge: sessionAge, path: '/' });
}
export async function createGuest(db) {
  const id = randomUUID();
  await db.query('INSERT INTO players(id, display_name, created_at) VALUES($1,$2,$3)', [id, 'Bạn cờ', Date.now()]);
  return { id, display_name: 'Bạn cờ', account_id: null, email: null };
}
export const userView = user => ({ id: user.id, name: user.display_name, account: !!user.account_id, email: user.email || null });
