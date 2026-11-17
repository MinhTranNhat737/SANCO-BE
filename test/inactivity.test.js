import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { createApplication } from '../src/app.js';
import { ROOM_INACTIVITY_MS } from '../src/rooms.js';
import { PRACTICE_INACTIVITY_MS } from '../src/practice.js';

async function makeClient(origin, name = 'Khách', register = true) {
  let cookie = '';
  const call = async (path, body, method) => {
    const response = await fetch(origin + '/api' + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: response.status, body: await response.json() };
  };
  const initial = await call('/me');
  assert.equal(initial.status, 200);
  if (register) {
    const reg = await call('/auth/register', { name, email: `${randomUUID()}@example.test`, password: 'a-long-test-password' });
    assert.equal(reg.status, 201);
  } else {
    await call('/me', { name }, 'PATCH');
  }
  return { call, get cookie() { return cookie; }, user: initial.body.user };
}

test('Default inactivity timeout is strictly 5 minutes (300000 ms)', () => {
  assert.equal(ROOM_INACTIVITY_MS, 5 * 60 * 1000);
  assert.equal(PRACTICE_INACTIVITY_MS, 5 * 60 * 1000);
});

test('Inactive room is cancelled, deleted from DB, notifies players via socket, and preserves completed match history', async () => {
  const app = await createApplication({ database: { memory: true }, disableRateLimits: true, inactivityMs: 180 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const a = await makeClient(origin, 'An');
    const b = await makeClient(origin, 'Bình');

    const socket = io(origin, { extraHeaders: { cookie: a.cookie }, transports: ['websocket'] });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const closedEvents = [];
    socket.on('room-closed', payload => closedEvents.push(payload));

    const created = await a.call('/rooms', { minutes: 5, kind: 'caro' });
    assert.equal(created.status, 201);
    const roomId = created.body.room.id;

    // Activity keeps the room alive before 180ms elapses
    await new Promise(r => setTimeout(r, 90));
    const joined = await b.call(`/rooms/${roomId}/join`, { token: created.body.token });
    assert.equal(joined.status, 200);
    let room = joined.body.room;

    // Ready both & finish one match (resign) so matches table references room_id
    room = (await a.call(`/rooms/${roomId}/actions`, { actionId: randomUUID(), version: room.version, action: 'ready' })).body.room;
    room = (await b.call(`/rooms/${roomId}/actions`, { actionId: randomUUID(), version: room.version, action: 'ready' })).body.room;
    assert.equal(room.game.phase, 'playing');

    const resigned = await b.call(`/rooms/${roomId}/actions`, { actionId: randomUUID(), version: room.version, action: 'resign' });
    assert.equal(resigned.status, 200);
    assert.equal(resigned.body.room.game.phase, 'finished');

    // Still exists right away
    assert.equal((await a.call('/rooms')).body.rooms.length, 1);
    assert.equal((await a.call('/history')).body.matches.length, 1);

    // Wait past inactivityMs so the exact-deadline sweep runs
    await new Promise(r => setTimeout(r, 260));

    // Socket notification fired
    assert.ok(closedEvents.some(e => e.id === roomId && e.reason === 'inactive'));

    // Room is completely deleted from SQL & API
    const mineAfter = await a.call('/rooms');
    assert.equal(mineAfter.body.rooms.length, 0);
    const fetchDeleted = await a.call(`/rooms/${roomId}`);
    assert.ok([404, 410].includes(fetchDeleted.status));
    const rowCount = await app.db.query('SELECT count(*)::int AS n FROM rooms WHERE id=$1', [roomId]);
    assert.equal(rowCount.rows[0].n, 0);

    // Match history is preserved cleanly (room_id nullified via ON DELETE SET NULL)
    const histAfter = await a.call('/history');
    assert.equal(histAfter.body.matches.length, 1);

    socket.close();
  } finally {
    await app.close();
  }
});

test('Inactive practice table is automatically cancelled and deleted', async () => {
  const app = await createApplication({ database: { memory: true }, disableRateLimits: true, inactivityMs: 160 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;

  try {
    const a = await makeClient(origin, 'Người chơi');
    const socket = io(origin, { extraHeaders: { cookie: a.cookie }, transports: ['websocket'] });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const closedEvents = [];
    socket.on('practice-closed', payload => closedEvents.push(payload));

    const created = await a.call('/practice', { kind: 'chess', difficulty: 'easy', side: 'first' });
    assert.equal(created.status, 201);
    const gameId = created.body.game.id;
    assert.equal((await a.call('/practice')).body.games.length, 1);

    await new Promise(r => setTimeout(r, 250));

    assert.ok(closedEvents.some(e => e.id === gameId && e.reason === 'inactive'));
    assert.equal((await a.call('/practice')).body.games.length, 0);
    const getDeleted = await a.call(`/practice/${gameId}`);
    assert.ok([404, 410].includes(getDeleted.status));

    socket.close();
  } finally {
    await app.close();
  }
});
