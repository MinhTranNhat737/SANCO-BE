import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPractice, makePracticeMove } from '../src/practice-engine.js';
import { VN_CELLS, vietnamLegal, vietnamMove, vietnamRent, vietnamBuyoutPrice, eliminateVietnam, chooseVietnam } from '../src/vietnam-estate.js';
import { openDatabase } from '../src/database.js';
import { createGuest } from '../src/auth.js';
import { RoomService } from '../src/rooms.js';
import { PracticeService } from '../src/practice.js';
import { MONOPOLY_TURN_MS, MONOPOLY_ROLL_GRACE_MS, newGame, startRoomGame, clockDeadline, settleTimeout, applyAction } from '../src/room-game.js';
import { trueRollDie } from '../src/party-games.js';
const create = () => createPractice('monopoly', 'R', 'medium', randomUUID());
const move = (g, action, to = -1, details = {}) => vietnamMove(g, { action, to, from: null, details }, () => 1);

test('Vietnam edition has all 34 unique provinces on 48 spaces, 2 dice and no 30-round shortcut', () => {
  assert.equal(VN_CELLS.length, 48); assert.equal(new Set(VN_CELLS.filter(c => c.type === 'property').map(c => c.name)).size, 34);
  const g = create(); assert.equal(g.party.property.length, 48); assert.equal(g.party.players[0].cash, 3000); g.party.round = 31; g.party.stage = 'end'; move(g, 'end'); assert.equal(g.phase, 'playing');
  const dice = [2, 3]; vietnamMove(g, { action: 'roll', to: -1 }, () => dice.shift() || 1); assert.deepEqual(g.party.diceValues, [2, 3]); assert.equal(g.party.players[1].position, 5);
});
test('Cash gifts conserve player cash and reject invalid, self, insufficient and inactive recipients', () => {
  const g = create(), [a, b] = g.party.players; move(g, 'gift', -1, { partner: 'G', amount: 250 }); assert.deepEqual([a.cash, b.cash], [2750, 3250]);
  for (const details of [{ partner: 'G', amount: -1 }, { partner: 'R', amount: 1 }, { partner: 'G', amount: 2.5 }, { partner: 'G', amount: 100000 }]) assert.throws(() => move(g, 'gift', -1, details));
  assert.deepEqual([a.cash, b.cash], [2750, 3250]);
});
test('Bilateral property exchanges settle atomically only after recipient approval and resume the proposer turn', () => {
  const g = create(), p = g.party; p.property[1] = 'R'; p.property[2] = 'G';
  move(g, 'offer', -1, { partner: 'G', pay: 200, ask: 50, give: [1], take: [2] }); assert.equal(g.turn, 'G'); assert.equal(p.property[1], 'R'); assert.equal(p.stage, 'deal');
  move(g, 'accept'); assert.deepEqual(p.property.slice(1, 3), ['G', 'R']); assert.equal(p.players[0].cash, 2850); assert.equal(p.players[1].cash, 3150); assert.equal(g.turn, 'R'); assert.equal(p.stage, 'roll');
  p.mortgaged[2] = true; assert.throws(() => move(g, 'offer', -1, { partner: 'G', pay: 0, ask: 0, give: [2], take: [] }));
  assert.throws(() => move(g, 'offer', -1, { partner: 'G', pay: 0, ask: 0, give: [1], take: [] }));
});
test('Loan needs consent, records fixed interest and individual lap maturity, and can be repaid early', () => {
  const g = create(), p = g.party; move(g, 'loan', -1, { partner: 'G', principal: 500, interest: 10, term: 2 }); assert.equal(p.loans.length, 0); move(g, 'accept');
  const loan = p.loans[0]; assert.equal(loan.total, 550); assert.equal(loan.dueLap, 2); assert.deepEqual(p.players.map(v => v.cash), [2500, 3500]);
  p.stage = 'end'; move(g, 'end'); move(g, 'repay', loan.id); assert.equal(loan.status, 'repaid'); assert.deepEqual(p.players.map(v => v.cash), [3050, 2950]); assert.throws(() => move(g, 'repay', loan.id));
});
test('Due loans enter durable debt, can be covered by mortgage and are charged only once', () => {
  const g = create(), p = g.party; move(g, 'loan', -1, { partner: 'G', principal: 500, interest: 10, term: 1 }); move(g, 'accept'); p.stage = 'end'; move(g, 'end');
  const borrower = p.players[1]; borrower.position = 47; borrower.cash = 0; p.property[47] = 'G';
  const dice = [1, 2]; vietnamMove(g, { action: 'roll', to: -1 }, () => dice.shift() || 1); assert.equal(borrower.laps, 1); assert.equal(p.stage, 'debt'); assert.equal(p.debt.loanId, p.loans[0].id);
  const before = p.players[0].cash; move(g, 'mortgage', 47); assert.equal(p.loans[0].status, 'repaid'); assert.equal(p.players[0].cash, before + 550); assert.equal(p.debt, null); assert.equal(p.mortgaged[47], true);
});
test('Auctions rotate bidders, enforce budget/minimum increments and award the highest bid once', () => {
  const g = create(), p = g.party; p.players[0].position = 1; p.stage = 'buy'; move(g, 'auction'); assert.equal(g.turn, 'G');
  assert.throws(() => move(g, 'bid', -1, { amount: 9 })); assert.throws(() => move(g, 'bid', -1, { amount: 100000 })); move(g, 'bid', -1, { amount: 100 }); assert.equal(g.turn, 'R'); move(g, 'pass_bid');
  assert.equal(p.property[1], 'G'); assert.equal(p.players[1].cash, 2900); assert.equal(g.turn, 'R'); assert.equal(p.stage, 'end'); assert.equal(p.auction, null);
});
test('Balanced building reaches hotels, stocks reconcile and mortgaged land earns no rent', () => {
  const g = create(), p = g.party, group = VN_CELLS.filter(c => c.type === 'property' && c.group === 0); for (const c of group) p.property[c.index] = 'R'; p.players[0].cash = 10000;
  const lots = group.map(c => c.index); move(g, 'build', lots[0]); assert.equal(vietnamLegal(g).some(m => m.action === 'build' && m.to === lots[0]), false);
  for (let level = 0; level < 5; level++)for (const i of lots) if (p.houses[i] === level) move(g, 'build', i);
  assert.ok(lots.every(i => p.houses[i] === 5)); assert.equal(p.bank.hotels, 16 - group.length); assert.equal(p.bank.houses, 64);
  move(g, 'clear_group', lots[0]); assert.equal(p.bank.hotels, 16); assert.ok(lots.every(i => p.houses[i] === 0));
  move(g, 'mortgage', lots[0]); assert.equal(vietnamRent(g, lots[0]), 0); move(g, 'redeem', lots[0]); assert.ok(vietnamRent(g, lots[0]) > 0);
});
test('Third consecutive double sends to jail; jail can be exited with a card or bail', () => {
  const g = create(), p = g.party; for (let i = 0; i < 2; i++) { vietnamMove(g, { action: 'roll', to: -1 }, () => 1); p.stage = 'end'; move(g, 'end'); }
  vietnamMove(g, { action: 'roll', to: -1 }, () => 1); assert.equal(p.players[0].position, 16); assert.equal(p.players[0].jail, 3); p.stage = 'roll'; p.players[0].jailCards = 1; move(g, 'jail_card'); assert.equal(p.players[0].jail, 0); assert.equal(p.players[0].jailCards, 0);
});
test('Resignation cancels pending contracts without giving money and redirects insolvent loans correctly', () => {
  const g = create(), p = g.party; move(g, 'loan', -1, { partner: 'G', principal: 500, interest: 5, term: 2 }); eliminateVietnam(g, 'R'); assert.equal(p.players[1].cash, 3000); assert.equal(g.phase, 'finished'); assert.equal(g.result.winner, 'G');
});
test('Bot evaluates received trades and produces server-validated bids', () => {
  const g = create(); move(g, 'offer', -1, { partner: 'G', pay: 100, ask: 0, give: [], take: [] }); const answer = chooseVietnam(g); assert.equal(answer.action, 'accept'); makePracticeMove(g, answer); assert.equal(g.turn, 'R');
});
test('Monopoly rooms support up to 8 players with unique sides and default to casual mode', async () => {
  const db = await openDatabase({ memory: true }), rooms = new RoomService(db);
  try {
    const users = await Promise.all(Array.from({ length: 8 }, () => createGuest(db)));
    const created = await rooms.create(users[0], 60, 'monopoly', 'first', 8);
    assert.equal(created.room.ranked, false);
    assert.equal(created.room.capacity, 8);
    assert.deepEqual(created.room.game.party.sides, ['R', 'G', 'Y', 'B', 'P', 'O', 'C', 'K']);
    assert.equal(created.room.game.party.bank.houses, 96);
    for (let i = 1; i < 8; i++)await rooms.join(created.room.id, users[i], created.token);
    let room = await rooms.get(created.room.id, users[0].id);
    assert.equal(room.players.length, 8);
    assert.deepEqual(room.players.map(p => p.mark), ['R', 'G', 'Y', 'B', 'P', 'O', 'C', 'K']);
    for (const u of users) room = await rooms.act(room.id, u.id, { actionId: randomUUID(), version: room.version, action: 'ready' });
    assert.equal(room.game.phase, 'playing');
    assert.equal(room.game.turn, 'R');
    const rand = await rooms.create(users[0], 60, 'monopoly', 'random', 8);
    for (let i = 1; i < 8; i++)await rooms.join(rand.room.id, users[i], rand.token);
    const randRoom = await rooms.get(rand.room.id, users[0].id);
    assert.deepEqual(randRoom.players.map(p => p.mark).sort(), ['B', 'C', 'G', 'K', 'O', 'P', 'R', 'Y']);
    await assert.rejects(() => rooms.create(users[0], 60, 'monopoly', 'first', 9), /Số người không hợp lệ/);
    await assert.rejects(() => rooms.create(users[0], 5, 'ludo', 'first', 5), /Số người không hợp lệ/);
  } finally { rooms.close(); await db.close(); }
});
test('Skipping an unowned lot skips auction and ends turn; empty auction also skips turn immediately', () => {
  const g = create(), p = g.party;
  p.players[0].position = 1; p.stage = 'buy';
  move(g, 'skip_buy');
  assert.equal(p.property[1], null);
  assert.equal(p.auction, null);
  assert.equal(g.turn, 'G');
  assert.equal(p.stage, 'roll');

  p.players[1].position = 2; p.stage = 'buy';
  move(g, 'auction');
  assert.equal(g.turn, 'R');
  move(g, 'pass_bid');
  assert.equal(g.turn, 'G');
  move(g, 'pass_bid');
  assert.equal(p.property[2], null);
  assert.equal(p.auction, null);
  assert.equal(g.turn, 'R');
  assert.equal(p.stage, 'roll');

  p.players[0].position = 3; p.stage = 'buy';
  move(g, 'buy', 3);
  assert.equal(p.property[3], 'R');
  assert.equal(p.lastPurchase.lot, 3);
  assert.equal(p.lastPurchase.side, 'R');
  assert.equal(p.lastPurchase.source, 'buy');
});
test('Chance/community cards, tax, jail, rent and cash deductions emit structured events with reasons', () => {
  const g = create(), p = g.party;
  const chanceIdx = VN_CELLS.find(c => c.type === 'chance').index;
  const taxCell = VN_CELLS.find(c => c.type === 'tax');
  const jailIdx = VN_CELLS.find(c => c.type === 'gotojail').index;

  // Draw card 2 (repair fee -120) on Chance
  p.players[0].position = (chanceIdx - 3 + 48) % 48;
  const seq1 = [1, 2, 2];
  vietnamMove(g, { action: 'roll', to: -1 }, () => seq1.shift() || 1);
  assert.ok(p.events.some(e => e.type === 'card' && e.deck === 'chance' && e.card === 2 && e.amount === -120));
  assert.ok(p.events.some(e => e.type === 'loss' && e.amount === -120 && e.reason.includes('Sửa chữa')));

  // Land on Tax
  p.stage = 'end'; move(g, 'end');
  p.players[1].position = (taxCell.index - 3 + 48) % 48;
  const seq2 = [1, 2];
  vietnamMove(g, { action: 'roll', to: -1 }, () => seq2.shift() || 1);
  assert.ok(p.events.some(e => e.type === 'tax' && e.side === 'G' && e.amount === -taxCell.amount));

  // Land on Go To Jail
  p.stage = 'end'; move(g, 'end');
  p.players[0].position = (jailIdx - 3 + 48) % 48;
  const seq3 = [1, 2];
  vietnamMove(g, { action: 'roll', to: -1 }, () => seq3.shift() || 1);
  assert.ok(p.events.some(e => e.type === 'jail' && e.side === 'R' && e.reason.includes('Trại giam')));
});
test('Monopoly rooms enforce a 30-second max turn limit and auto-advance on expiry', () => {
  const t0 = 1_000_000;
  const game = newGame(60 * 60_000, 'turn-cap-test', 'monopoly', 3);
  const room = { kind: 'monopoly', game };
  startRoomGame(game, t0);
  assert.equal(game.turnLimitMs, 30_000);
  assert.equal(MONOPOLY_TURN_MS, 30_000);
  assert.equal(clockDeadline(game), t0 + 30_000);
  assert.equal(settleTimeout(room, t0 + 29_999), false);
  assert.equal(settleTimeout(room, t0 + 30_000), true);
  assert.equal(game.phase, 'playing');
  assert.equal(game.turn, 'G');
  assert.equal(game.turnDeadline, t0 + 60_000);

  // Auction turn timeout auto-passes bidder
  game.party.players[1].position = 1; game.party.stage = 'buy';
  vietnamMove(game, { action: 'auction', to: -1 }, () => 1);
  assert.equal(game.turn, 'Y');
  game.turnDeadline = t0 + 90_000;
  assert.equal(settleTimeout(room, t0 + 90_000), true);
  assert.ok(game.party.auction.passed.includes('Y'));
});
test('CSPRNG dice roll produces unbiased uniform independent outcomes across all 6 faces and 36 pairs', () => {
  const counts = Array(7).fill(0), pairs = new Set();
  const N = 3600;
  for (let i = 0; i < N; i++) {
    const a = trueRollDie(), b = trueRollDie();
    assert.ok(Number.isInteger(a) && a >= 1 && a <= 6);
    assert.ok(Number.isInteger(b) && b >= 1 && b <= 6);
    counts[a]++; counts[b]++;
    pairs.add(`${a},${b}`);
  }
  const expected = (N * 2) / 6;
  for (let face = 1; face <= 6; face++) {
    assert.ok(Math.abs(counts[face] - expected) < expected * 0.15, `Face ${face} count ${counts[face]} deviated too far from ${expected}`);
  }
  assert.equal(pairs.size, 36, 'All 36 independent pairs must occur');
});
test('Monopoly practice bot respects post-roll delay and is never bypassed by pump().finally() or get()', async () => {
  const db = await openDatabase({ memory: true });
  const events = [];
  const practice = new PracticeService(db, (view) => {
    events.push({ at: Date.now(), version: view.version, moves: view.moves.length, lastAction: view.moves.at(-1)?.action || null, turn: view.turn });
  }, { partyBotDelayMs: 300 });
  try {
    const user = await createGuest(db);
    const createdAt = Date.now();
    const created = await practice.create(user, { kind: 'monopoly', difficulty: 'medium', side: 'second' });
    assert.equal(created.turn, 'R');
    assert.equal(created.humanSide, 'G');
    // Wait for bot's first move (roll)
    const deadline = Date.now() + 4000;
    while (!events.some(e => e.lastAction === 'roll') && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 20));
    }
    const rollEvt = events.find(e => e.lastAction === 'roll');
    assert.ok(rollEvt, 'Bot must emit its roll move');
    assert.ok(rollEvt.at - createdAt >= 120, `Bot opening roll should wait for board mount (elapsed ${rollEvt.at - createdAt}ms)`);

    // Calling get() immediately after roll must NOT bypass the post-roll animation delay
    await practice.get(created.id, user.id);
    await new Promise(r => setTimeout(r, 120));
    assert.equal(events.filter(e => e.moves > rollEvt.moves).length, 0, 'Bot must NOT execute follow-up action while dice/walk delay is still active');

    // Wait for bot's follow-up move (buy / skip_buy / auction / end / doubles roll)
    while (!events.some(e => e.moves > rollEvt.moves) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 20));
    }
    const nextEvt = events.find(e => e.moves > rollEvt.moves);
    assert.ok(nextEvt, 'Bot must execute follow-up action after post-roll delay elapses');
    assert.ok(nextEvt.at - rollEvt.at >= 260, `Bot follow-up action must wait at least partyBotDelayMs after roll (elapsed ${nextEvt.at - rollEvt.at}ms)`);
  } finally {
    await practice.close();
    await db.close();
  }
});
test('Landing on opponent land allows buyout including building value when affordable, preserves houses, and skips when cash is insufficient', () => {
  const g = create(), p = g.party;
  const lot = VN_CELLS.find(c => c.type === 'property' && c.index > 2);
  const groupLots = VN_CELLS.filter(c => c.type === 'property' && c.group === lot.group);
  // Opponent G owns full group with 3 houses on lot and 3 houses on sibling
  for (const c of groupLots) { p.property[c.index] = 'G'; p.houses[c.index] = 3; }
  const expectedPrice = lot.price + 3 * lot.buildCost;
  assert.equal(vietnamBuyoutPrice(p, lot.index), expectedPrice);

  // R rolls and lands on lot -> pays rent first, still has plenty of cash -> stage === 'buyout'
  p.players[0].position = (lot.index - 3 + 48) % 48;
  const rBefore = p.players[0].cash, gBefore = p.players[1].cash;
  const rent = vietnamRent(g, lot.index, 3);
  const dice1 = [1, 2];
  vietnamMove(g, { action: 'roll', to: -1 }, () => dice1.shift() || 1);
  assert.equal(p.stage, 'buyout');
  assert.equal(p.players[0].cash, rBefore - rent);
  assert.equal(p.players[1].cash, gBefore + rent);
  assert.ok(vietnamLegal(g).some(m => m.action === 'buyout' && m.to === lot.index));

  // R buys out the lot -> pays land + 3 houses to G, ownership transfers, 3 houses stay intact!
  move(g, 'buyout', lot.index);
  assert.equal(p.property[lot.index], 'R');
  assert.equal(p.houses[lot.index], 3, 'Existing houses must remain on the bought-out lot');
  assert.equal(p.players[0].cash, rBefore - rent - expectedPrice);
  assert.equal(p.players[1].cash, gBefore + rent + expectedPrice);
  assert.equal(p.lastPurchase.source, 'buyout');
  assert.equal(p.lastPurchase.fromSide, 'G');
  assert.equal(p.lastPurchase.houses, 3);
  assert.equal(p.stage, 'end');

  // G can still clear/sell buildings on G's own remaining lots without affecting R's bought-out lot
  move(g, 'end');
  const gSibling = groupLots.find(c => c.index !== lot.index);
  move(g, 'clear_group', gSibling.index);
  assert.equal(p.houses[gSibling.index], 0);
  assert.equal(p.houses[lot.index], 3, 'Previous owner clearing buildings must never demolish buyer houses');

  // Insufficient cash case: G lands on R's lot with 3 houses, pays rent, does NOT have enough for buyout -> stage === 'end'
  p.players[1].position = (lot.index - 3 + 48) % 48;
  const rentBack = vietnamRent(g, lot.index, 3);
  p.players[1].cash = rentBack + expectedPrice - 10; // 10 short of buyout!
  const dice2 = [1, 2];
  vietnamMove(g, { action: 'roll', to: -1 }, () => dice2.shift() || 1);
  assert.equal(p.stage, 'end', 'Must skip buyout stage when player cannot afford land + houses after rent');
  assert.equal(vietnamLegal(g).some(m => m.action === 'buyout'), false);

  // Skip buyout with doubles keeps extra roll; bot chooses buyout when rich and skips when low on cash
  move(g, 'end');
  p.property[gSibling.index] = 'G'; p.houses[gSibling.index] = 0;
  p.players[0].position = (gSibling.index - 4 + 48) % 48;
  p.players[0].cash = 2000;
  const dice3 = [2, 2];
  vietnamMove(g, { action: 'roll', to: -1 }, () => dice3.shift() || 1);
  assert.equal(p.stage, 'buyout');
  assert.equal(chooseVietnam(g).action, 'buyout');
  move(g, 'skip_buyout');
  assert.equal(g.turn, 'R', 'Declining buyout after rolling doubles keeps extra roll');
  assert.equal(p.stage, 'roll');
});
test('Monopoly supports unlimited or custom match duration and excludes dice roll time from the 30s turn clock', async () => {
  const db = await openDatabase({ memory: true }), rooms = new RoomService(db);
  try {
    const [host, guest] = await Promise.all([createGuest(db), createGuest(db)]);
    // Unlimited room (minutes = 0)
    const unlim = await rooms.create(host, 0, 'monopoly', 'first', 2);
    assert.equal(unlim.room.duration, 0);
    assert.equal(unlim.room.game.unlimited, true);
    assert.equal(unlim.room.game.matchLimitMs, null);
    assert.equal(unlim.room.game.matchDeadline, undefined);

    // Custom match duration (minutes = 45)
    const timed = await rooms.create(host, 45, 'monopoly', 'first', 2);
    assert.equal(timed.room.duration, 45 * 60_000);
    assert.equal(timed.room.game.unlimited, false);
    assert.equal(timed.room.game.matchLimitMs, 45 * 60_000);

    // Reject out-of-range durations
    await assert.rejects(() => rooms.create(host, 2, 'monopoly', 'first', 2), /Thời gian ván Tỷ phú/);
    await assert.rejects(() => rooms.create(host, 400, 'monopoly', 'first', 2), /Thời gian ván Tỷ phú/);

    // Verify 30s thinking clock excludes dice roll + walk grace window
    const t0 = 2_000_000;
    const g = newGame(45 * 60_000, 'roll-grace-test', 'monopoly', 2);
    const room = {
      kind: 'monopoly',
      duration: 45 * 60_000,
      owner: { id: host.id, name: host.name, mark: 'R', ready: true },
      players: [
        { id: host.id, name: host.name, mark: 'R', ready: true },
        { id: guest.id, name: guest.name, mark: 'G', ready: true },
      ],
      game: g,
    };
    startRoomGame(g, t0);
    assert.equal(g.matchDeadline, t0 + 45 * 60_000);
    assert.equal(g.turnThinkStartAt, t0);
    assert.equal(g.turnDeadline, t0 + 30_000);

    const tRoll = t0 + 5_000;
    applyAction(room, host.id, 'move', { action: 'roll', to: -1 }, tRoll);
    assert.ok(g.turnThinkStartAt >= tRoll + MONOPOLY_ROLL_GRACE_MS, '30s thinking timer must start after roll + walk grace window');
    assert.equal(g.turnDeadline, g.turnThinkStartAt + 30_000, 'Full 30s thinking budget must be preserved after dice roll');

    // Timed match expires at matchDeadline and settles by net wealth
    g.party.players[0].cash = 5000;
    g.party.players[1].cash = 1000;
    assert.equal(settleTimeout(room, t0 + 45 * 60_000), true);
    assert.equal(g.phase, 'finished');
    assert.equal(g.result.reason, 'wealth');
    assert.equal(g.result.winner, 'R');
  } finally {
    rooms.close();
    await db.close();
  }
});
