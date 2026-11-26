import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newVietnam, startVietnam, VN_CELLS, vietnamMove, vietnamLegal, vietnamWealth, vietnamRent, vietnamBuildCost, vietnamGroupBuildCost, chooseVietnam, timeoutVietnamTurn, eliminateVietnam } from '../src/vietnam-estate.js';
import { estateProfile, changeMarket, estateSalary } from '../src/estate-modes.js';
import { newGame, applyAction, clockDeadline, settleTimeout } from '../src/room-game.js';
import { openDatabase } from '../src/database.js';
import { createGuest } from '../src/auth.js';
import { RoomService } from '../src/rooms.js';

const make = (count = 2, selection = 'auto', sides) => { const g = { id: randomUUID(), kind: 'monopoly', phase: 'playing', turn: sides?.[0] || 'R', party: newVietnam(count, selection, sides) }; startVietnam(g, () => 0); return g; };
const move = (g, action, to = -1, details = {}, roll = () => 1) => vietnamMove(g, { action, to, details }, roll);
const has = (g, action) => vietnamLegal(g).some(m => m.action === action);
const cash = p => p.players.reduce((sum, player) => sum + player.cash, 0);

test('Profiles cover actual counts 2–8 with simplified creative bankruptcy rules, preserve legacy and validate tile names', () => {
  assert.equal(VN_CELLS[4].name, 'Khí vận'); assert.equal(VN_CELLS[4].type, 'community');
  assert.equal(VN_CELLS[28].name, 'Cơ hội'); assert.equal(VN_CELLS[28].type, 'chance');
  for (let n = 2; n <= 8; n++) {
    const p = newVietnam(n, 'auto'); assert.equal(p.profile.playerCount, n); assert.equal(p.started, false); assert.equal(p.property.filter(Boolean).length, 0);
    assert.equal(p.profile.id, 'creative'); assert.equal(p.profile.name, 'Sáng tạo');
    assert.equal(p.profile.roundLimit, null); assert.equal(p.profile.marketEvery, 0); assert.equal(p.profile.initialLots, 0); assert.equal(p.profile.groupBuild, true);
    assert.deepEqual(p.players.map(player => player.cash), Array(n).fill(3000));
    const classic = estateProfile(n, 'classic');
    assert.equal(classic.id, 'classic'); assert.equal(classic.roundLimit, null); assert.equal(classic.marketEvery, 0); assert.equal(classic.groupBuild, true);
  }
  assert.equal(estateProfile(2, undefined), null); assert.equal(newVietnam(2).profile, undefined);
  for (const n of [0, 1, 9, 2.5]) assert.throws(() => newVietnam(n, 'auto'));
  assert.throws(() => newVietnam(2, 'bad')); assert.throws(() => newVietnam(2, 'auto', ['R', 'R'])); assert.throws(() => newVietnam(2, 'auto', ['R', 'Z']));
});

test('Startup keeps fair 3000 capital with zero pre-assigned lots by default and supports custom initialLots', () => {
  for (let n = 2; n <= 8; n++) {
    const g = make(n), p = g.party;
    for (const me of p.players) { assert.equal(p.property.filter(side => side === me.side).length, 0); assert.equal(vietnamWealth(p, me.side), p.profile.startingCash); assert.equal(me.cash, 3000); }
    const before = structuredClone(p); startVietnam(g, () => 0); assert.deepEqual(p, before);
    assert.equal(p.bank.houses, n > 4 ? 96 : 64);
  }
  const custom = { id: randomUUID(), kind: 'monopoly', phase: 'playing', turn: 'R', party: newVietnam(3, 'auto') };
  custom.party.profile.initialLots = 2; startVietnam(custom, () => 0);
  for (const me of custom.party.players) {
    assert.equal(custom.party.property.filter(side => side === me.side).length, 2);
    assert.equal(vietnamWealth(custom.party, me.side), 3000);
  }
});

test('Host can start a partially filled room using real marks, real player count and fresh clocks', () => {
  const owner = { id: 'owner', mark: 'K', ready: false }, guest = { id: 'guest', mark: 'Y', ready: false };
  const room = { kind: 'monopoly', duration: 3600000, capacity: 8, estateMode: 'auto', owner, players: [owner, guest], game: newGame(3600000, 'start-real', 'monopoly', 8, 'auto') };
  assert.throws(() => applyAction(room, 'guest', 'start', {}, 100, 'next'));
  assert.throws(() => applyAction(room, 'owner', 'start', {}, 100, 'next'));
  applyAction(room, 'owner', 'ready', {}, 100, 'next'); applyAction(room, 'guest', 'ready', {}, 100, 'next'); assert.equal(room.game.phase, 'waiting');
  applyAction(room, 'owner', 'start', {}, 200, 'next'); const g = room.game;
  assert.equal(g.party.profile.id, 'creative'); assert.equal(g.party.players.length, 2); assert.deepEqual(g.party.sides, ['K', 'Y']); assert.equal(g.turn, 'K');
  assert.deepEqual(Object.keys(g.remaining), ['K', 'Y']); assert.equal(clockDeadline(g), 30200); assert.deepEqual(g.initialParty, g.party);
  assert.throws(() => applyAction(room, 'owner', 'start', {}, 201, 'next'));
  g.phase = 'finished'; applyAction(room, 'owner', 'rematch', {}, 300, 'rematch'); applyAction(room, 'guest', 'rematch', {}, 300, 'rematch');
  assert.equal(room.game.phase, 'waiting'); assert.deepEqual(room.game.party.sides, ['Y', 'K']);
  applyAction(room, 'owner', 'ready', {}, 400, 'next'); applyAction(room, 'guest', 'ready', {}, 400, 'next'); applyAction(room, 'owner', 'start', {}, 401, 'next');
  assert.equal(room.game.party.profile.playerCount, 2); assert.deepEqual(room.game.party.sides, ['Y', 'K']);
});

test('Skipping buying opens an auction; an empty auction preserves an earned double', () => {
  const g = make(3), p = g.party; p.property[1] = null; p.players[0].position = 1; p.stage = 'buy'; p.extraRoll = true;
  move(g, 'skip_buy'); assert.equal(p.stage, 'auction'); assert.equal(g.turn, 'G');
  for (let i = 0; i < 3; i++)move(g, 'pass_bid');
  assert.equal(g.turn, 'R'); assert.equal(p.stage, 'end'); assert.equal(p.property[1], null);
  move(g, 'end'); assert.equal(g.turn, 'R'); assert.equal(p.stage, 'roll'); assert.equal(p.round, 1);
});

test('Auction timeouts and winner elimination cannot strand bidding or charge twice', () => {
  const g = make(4), p = g.party; p.property[1] = null; p.players[0].position = 1; p.stage = 'buy'; move(g, 'auction');
  move(g, 'bid', -1, { amount: VN_CELLS[1].price + 100 }); assert.equal(p.auction.leader, 'G'); eliminateVietnam(g, 'G');
  for (let i = 0; i < 10 && p.stage === 'auction'; i++)timeoutVietnamTurn(g);
  assert.equal(p.auction, null); assert.ok(p.players.find(player => player.side === g.turn).active); assert.equal(p.property[1], null);
  const before = cash(p); p.players.find(player => player.side === g.turn).position = 1; p.stage = 'buy'; move(g, 'auction'); const bidder = g.turn;
  move(g, 'bid', -1, { amount: VN_CELLS[1].price + 100 }); while (p.stage === 'auction') move(g, 'pass_bid');
  assert.equal(p.property[1], bidder); assert.equal(cash(p), before - VN_CELLS[1].price - 100); assert.throws(() => move(g, 'bid', -1, { amount: 110 })); assert.equal(cash(p), before - VN_CELLS[1].price - 100);
});

test('Counteroffers exchange direction, settle atomically and restore original turn and phase', () => {
  const g = make(3), p = g.party; p.property.fill(null); p.property[1] = 'R'; p.property[2] = 'G';
  const before = cash(p), balances = p.players.map(player => player.cash);
  move(g, 'offer', -1, { partner: 'G', pay: 200, ask: 50, give: [1], take: [2] });
  const pending = structuredClone(p.pending); assert.throws(() => move(g, 'counter_offer', -1, { pay: 99999, ask: 0, give: [2], take: [1] })); assert.deepEqual(p.pending, pending);
  move(g, 'counter_offer', -1, { pay: 100, ask: 250, give: [2], take: [1] });
  assert.equal(g.turn, 'R'); assert.equal(p.pending.returnSide, 'R'); assert.equal(p.pending.counters, 1); assert.deepEqual(p.property.slice(1, 3), ['R', 'G']); assert.equal(cash(p), before);
  move(g, 'accept'); assert.equal(g.turn, 'R'); assert.equal(p.stage, 'roll'); assert.equal(p.pending, null); assert.equal(cash(p), before);
  assert.deepEqual(p.property.slice(1, 3), ['G', 'R']); assert.deepEqual(p.players.map(player => player.cash), [balances[0] - 150, balances[1] + 150, balances[2]]);
});

test('Counter limit, offer limit, refusal and timeout obey the same state machine', () => {
  const g = make(), p = g.party;
  move(g, 'offer', -1, { partner: 'G', pay: 1, ask: 0, give: [], take: [] });
  for (let i = 0; i < 3; i++)move(g, 'counter_offer', -1, { pay: 1, ask: 0, give: [], take: [] });
  assert.equal(has(g, 'counter_offer'), false); assert.throws(() => move(g, 'counter_offer', -1, { pay: 1, ask: 0, give: [], take: [] }));
  timeoutVietnamTurn(g); assert.equal(g.turn, 'R'); assert.equal(p.stage, 'roll');
  move(g, 'offer', -1, { partner: 'G', pay: 1, ask: 0, give: [], take: [] }); move(g, 'reject'); assert.equal(has(g, 'offer'), false); assert.equal(has(g, 'loan'), false);
  p.stage = 'end'; move(g, 'end'); p.stage = 'end'; move(g, 'end'); assert.equal(has(g, 'offer'), true);
});

test('Resigning either contract participant after countering restores a live turn', () => {
  for (const leaving of ['R', 'G']) {
    const g = make(3), p = g.party; move(g, 'offer', -1, { partner: 'G', pay: 1, ask: 0, give: [], take: [] }); move(g, 'counter_offer', -1, { pay: 1, ask: 0, give: [], take: [] });
    eliminateVietnam(g, leaving); assert.equal(p.pending, null); assert.equal(p.stage, 'roll'); assert.ok(p.players.find(player => player.side === g.turn).active);
  }
});

test('Creative mode disables market cycles by default while explicit marketEvery still rotates cleanly', () => {
  const def = make(3); def.party.round = 3; def.turn = 'Y'; def.party.stage = 'end'; move(def, 'end');
  assert.equal(def.party.round, 4); assert.equal(def.party.market, null);
  for (const [count, every] of [[2, 3], [4, 3], [8, 2]]) {
    const g = make(count), p = g.party; p.profile.marketEvery = every;
    for (let round = 1; round <= every; round++) { p.round = round; assert.equal(changeMarket(p, () => 0), null); }
    p.round = every + 1; const first = changeMarket(p, () => 0); assert.equal(first.startRound, every + 1); assert.equal(first.endRound, every * 2);
    p.round = every * 2 + 1; assert.notEqual(changeMarket(p, () => 0).id, first.id);
  }
  const g = make(3), p = g.party; p.profile.marketEvery = 3; p.round = 3; g.turn = 'Y'; p.stage = 'end'; move(g, 'end'); assert.equal(p.round, 4); assert.ok(p.market); assert.equal(p.events.at(-1).type, 'market');
});

test('Full-group construction, market rent and salary use integer rounding and upgrade all lots in the color group', () => {
  const g = make(), p = g.party; p.property.fill(null); p.market = { rentPercent: 125, buildPercent: 80, salaryPercent: 125 };
  const group = VN_CELLS.filter(cell => cell.type === 'property' && cell.group === 0);
  // Owning 2 of 3 tiles cannot build yet
  p.property[group[0].index] = 'R'; p.property[group[1].index] = 'R';
  assert.equal(vietnamLegal(g).some(m => m.action === 'build'), false);
  // Owning the full color group immediately unlocks full-group build!
  p.property[group[2].index] = 'R';
  assert.equal(vietnamRent(g, 1), Math.ceil(VN_CELLS[1].rent[0] * 2 * 1.25)); const before = p.players[0].cash;
  const expectedCost = group.reduce((sum, cell) => sum + vietnamBuildCost(p, cell.index), 0);
  assert.equal(vietnamGroupBuildCost(p, 1), expectedCost);
  move(g, 'build', 1);
  assert.deepEqual(group.map(cell => p.houses[cell.index]), [1, 1, 1], 'One build action upgrades the entire color group at once');
  assert.equal(p.players[0].cash, before - expectedCost); assert.equal(p.ledger.at(-1).amount, expectedCost);
  const utility = VN_CELLS.find(cell => cell.type === 'utility'); p.property[utility.index] = 'R'; assert.equal(vietnamRent(g, utility.index, 3), Math.ceil(3 * 5 * 1.25));
  const salary = estateSalary(p); assert.equal(salary, 625); p.players[0].position = 47; const cashBefore = p.players[0].cash; const dice = [1, 2]; move(g, 'roll', -1, {}, () => dice.shift() || 1);
  assert.equal(p.events.find(event => event.type === 'salary').amount, salary); assert.equal(p.players[0].cash, cashBefore + salary);
});

test('Start awards +500 and Free Parking (Nghỉ chân) awards +100 on landing', () => {
  const g = make(2, 'classic'), p = g.party;
  p.players[0].position = 21;
  const beforeRest = p.players[0].cash;
  const diceRest = [1, 2]; move(g, 'roll', -1, {}, () => diceRest.shift() || 1);
  assert.equal(p.players[0].position, 24);
  assert.equal(p.players[0].cash, beforeRest + 100);
  p.stage = 'end'; move(g, 'end');

  p.players[1].position = 45;
  const beforeStart = p.players[1].cash;
  const diceStart = [1, 2]; move(g, 'roll', -1, {}, () => diceStart.shift() || 1);
  assert.equal(p.players[1].position, 0);
  assert.equal(p.players[1].cash, beforeStart + 500);
});

test('All 12 event cards are reachable on Cơ hội and Khí vận without negative balances', () => {
  const chance = VN_CELLS.find(cell => cell.type === 'chance' && cell.index >= 3).index;
  for (let card = 1; card <= 12; card++) {
    const g = make(4), p = g.party; p.property.fill(null); p.players[0].position = chance - 3;
    const dice = [1, 2, Math.floor((card - 1) / 6) + 1, (card - 1) % 6 + 1]; move(g, 'roll', -1, {}, () => dice.shift() || 1);
    const ev = p.events.find(event => event.type === 'card' && event.card === card);
    assert.ok(ev, `card ${card}`);
    assert.equal(ev.sourceLot, chance, `card ${card} must record exact source tile (${chance})`);
    if ([4, 5, 6, 10].includes(card)) assert.equal(p.movement.via, chance, `movement card ${card} must walk via ${chance} first`);
    assert.notEqual(p.stage, 'debt'); assert.ok(p.players.every(player => player.cash >= 0));
  }
});

test('Shared event cash is conserved, capped by available cash, and multi-creditor debt clears in order', () => {
  const chance = VN_CELLS.find(cell => cell.type === 'chance' && cell.index >= 3).index;
  for (const card of [7, 8]) {
    const g = make(4), p = g.party; p.property.fill(null); p.players[0].position = chance - 3; p.players[1].cash = 3; p.players[2].cash = 0;
    const before = cash(p), dice = [1, 2, 2, card - 6]; move(g, 'roll', -1, {}, () => dice.shift() || 1); assert.equal(cash(p), before);
    if (card === 7) { assert.equal(p.players[1].cash, 0); assert.equal(p.players[2].cash, 0); }
  }
  const g = make(4), p = g.party; p.players[0].position = chance - 3; p.players[0].cash = 60; p.property.fill(null); p.property[1] = 'R'; p.property[3] = 'R';
  const before = cash(p), dice = [1, 2, 2, 2]; move(g, 'roll', -1, {}, () => dice.shift() || 1); assert.equal(p.stage, 'debt'); assert.equal(p.players[0].cash, 10);
  move(g, 'mortgage', 1); assert.equal(p.stage, 'debt'); move(g, 'mortgage', 3); assert.equal(p.stage, 'end'); assert.equal(p.payments.length, 0); assert.equal(cash(p), before + 140);
});

test('Creative and Classic modes play until bankruptcy (no round limit), while explicit roundLimit still settles net wealth', () => {
  for (const mode of ['auto', 'classic']) {
    const g = make(2, mode); g.party.round = 200; g.turn = 'G'; g.party.stage = 'end'; move(g, 'end');
    assert.equal(g.phase, 'playing'); assert.equal(g.party.market, null);
  }
  const capped = make(3); capped.party.profile.roundLimit = 24; capped.party.round = 24; capped.turn = 'G'; capped.party.stage = 'end'; move(capped, 'end'); assert.equal(capped.phase, 'playing');
  capped.party.players[0].cash += 50; capped.party.stage = 'end'; move(capped, 'end'); assert.equal(capped.phase, 'finished'); assert.equal(capped.result.winner, 'R'); assert.equal(capped.result.reason, 'wealth');
  const tie = make(3); tie.party.profile.roundLimit = 24; tie.party.round = 24; tie.turn = 'Y'; tie.party.stage = 'end'; move(tie, 'end'); assert.equal(tie.result.winner, null);
});

test('Timed state transitions rotate auctions and reject contracts rather than repeating charges', () => {
  const owner = { id: 'a', mark: 'R', ready: true }, guest = { id: 'b', mark: 'G', ready: true }, room = { kind: 'monopoly', duration: 3600000, capacity: 2, estateMode: 'auto', owner, players: [owner, guest], game: newGame(3600000, 'timeouts', 'monopoly', 2, 'auto') };
  applyAction(room, 'a', 'start', {}, 100, 'next'); const g = room.game, p = g.party;
  p.property[1] = null; p.players[0].position = 1; p.stage = 'buy'; assert.equal(settleTimeout(room, 30100), true); assert.equal(p.stage, 'auction'); assert.equal(g.turn, 'G'); assert.equal(clockDeadline(g), 60100);
  assert.equal(settleTimeout(room, 60100), true); assert.equal(g.turn, 'R'); assert.equal(p.stage, 'auction'); assert.equal(settleTimeout(room, 90100), true); assert.equal(p.stage, 'end');
});

test('Persisted early start is idempotent, rejects stale actions and blocks late joins', async () => {
  const db = await openDatabase({ memory: true }), rooms = new RoomService(db);
  try {
    const [a, b, c] = await Promise.all(Array.from({ length: 3 }, () => createGuest(db))), created = await rooms.create(a, 60, 'monopoly', 'second', 8, false, 'auto'), id = created.room.id;
    await rooms.join(id, b, created.token);
    const act = async (user, action) => { const view = await rooms.get(id, user.id); return rooms.act(id, user.id, { actionId: randomUUID(), version: view.version, action }); };
    await act(a, 'ready'); await act(b, 'ready'); const before = await rooms.get(id, a.id), body = { actionId: randomUUID(), version: before.version, action: 'start' };
    const started = await rooms.act(id, a.id, body), again = await rooms.act(id, a.id, body); assert.deepEqual(again.game.party, started.game.party); assert.equal(started.game.party.profile.playerCount, 2);
    await assert.rejects(() => rooms.act(id, a.id, { ...body, actionId: randomUUID() })); await assert.rejects(() => rooms.join(id, c, created.token));
    assert.equal((await rooms.get(id, b.id)).game.party.players.length, 2);
  } finally { rooms.close(); await db.close(); }
});

test('Seeded games for every count 2–8 preserve funds, ownership and physical building stock under full-group building', t => {
  let actions = 0, completed = 0;
  for (let count = 2; count <= 8; count++)for (let seed = 1; seed <= 12; seed++) {
    let r = seed * 317 + count; const random = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r; };
    const g = make(count), p = g.party; const initialHouses = p.bank.houses, initialHotels = p.bank.hotels;
    for (let n = 0; n < 1500 && g.phase === 'playing'; n++) {
      const request = chooseVietnam(g); assert.ok(request, `stuck ${count}/${seed} ${p.stage}`);
      vietnamMove(g, request, () => (random() >>> 8) % 6 + 1); actions++;
      for (const player of p.players) { assert.ok(Number.isSafeInteger(player.cash) && player.cash >= 0); assert.ok(player.position >= 0 && player.position < 48); }
      for (let i = 0; i < 48; i++) { assert.ok(Number.isInteger(p.houses[i]) && p.houses[i] >= 0 && p.houses[i] <= 5); if (p.property[i]) assert.ok(p.players.find(player => player.side === p.property[i])?.active); else assert.equal(p.houses[i], 0); }
      assert.equal(p.bank.houses + p.houses.reduce((sum, level) => sum + (level === 5 ? 0 : level), 0), initialHouses);
      assert.equal(p.bank.hotels + p.houses.filter(level => level === 5).length, initialHotels);
      if (g.phase === 'playing') assert.ok(p.players.find(player => player.side === g.turn)?.active);
    }
    if (g.phase === 'finished') { completed++; assert.equal(p.players.filter(v => v.active).length, 1); }
  }
  assert.ok(actions > 10000, `Only ${actions} actions`);
  t.diagnostic(`84 simulated games (${completed} bankruptcies within 1500 steps), ${actions} validated actions`);
});
