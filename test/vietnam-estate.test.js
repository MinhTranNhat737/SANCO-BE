import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPractice,makePracticeMove} from '../src/practice-engine.js';
import {VN_CELLS,vietnamLegal,vietnamMove,vietnamRent,eliminateVietnam,chooseVietnam} from '../src/vietnam-estate.js';
import {openDatabase} from '../src/database.js';
import {createGuest} from '../src/auth.js';
import {RoomService} from '../src/rooms.js';
const create=()=>createPractice('monopoly','R','medium',randomUUID());
const move=(g,action,to=-1,details={})=>vietnamMove(g,{action,to,from:null,details},()=>1);

test('Vietnam edition has all 34 unique provinces on 48 spaces, 2 dice and no 30-round shortcut',()=>{
  assert.equal(VN_CELLS.length,48);assert.equal(new Set(VN_CELLS.filter(c=>c.type==='property').map(c=>c.name)).size,34);
  const g=create();assert.equal(g.party.property.length,48);assert.equal(g.party.players[0].cash,3000);g.party.round=31;g.party.stage='end';move(g,'end');assert.equal(g.phase,'playing');
  const dice=[2,3];vietnamMove(g,{action:'roll',to:-1},()=>dice.shift()||1);assert.deepEqual(g.party.diceValues,[2,3]);assert.equal(g.party.players[1].position,5);
});
test('Cash gifts conserve player cash and reject invalid, self, insufficient and inactive recipients',()=>{
  const g=create(),[a,b]=g.party.players;move(g,'gift',-1,{partner:'G',amount:250});assert.deepEqual([a.cash,b.cash],[2750,3250]);
  for(const details of[{partner:'G',amount:-1},{partner:'R',amount:1},{partner:'G',amount:2.5},{partner:'G',amount:100000}])assert.throws(()=>move(g,'gift',-1,details));
  assert.deepEqual([a.cash,b.cash],[2750,3250]);
});
test('Bilateral property exchanges settle atomically only after recipient approval and resume the proposer turn',()=>{
  const g=create(),p=g.party;p.property[1]='R';p.property[2]='G';
  move(g,'offer',-1,{partner:'G',pay:200,ask:50,give:[1],take:[2]});assert.equal(g.turn,'G');assert.equal(p.property[1],'R');assert.equal(p.stage,'deal');
  move(g,'accept');assert.deepEqual(p.property.slice(1,3),['G','R']);assert.equal(p.players[0].cash,2850);assert.equal(p.players[1].cash,3150);assert.equal(g.turn,'R');assert.equal(p.stage,'roll');
  p.mortgaged[2]=true;assert.throws(()=>move(g,'offer',-1,{partner:'G',pay:0,ask:0,give:[2],take:[]}));
  assert.throws(()=>move(g,'offer',-1,{partner:'G',pay:0,ask:0,give:[1],take:[]}));
});
test('Loan needs consent, records fixed interest and individual lap maturity, and can be repaid early',()=>{
  const g=create(),p=g.party;move(g,'loan',-1,{partner:'G',principal:500,interest:10,term:2});assert.equal(p.loans.length,0);move(g,'accept');
  const loan=p.loans[0];assert.equal(loan.total,550);assert.equal(loan.dueLap,2);assert.deepEqual(p.players.map(v=>v.cash),[2500,3500]);
  p.stage='end';move(g,'end');move(g,'repay',loan.id);assert.equal(loan.status,'repaid');assert.deepEqual(p.players.map(v=>v.cash),[3050,2950]);assert.throws(()=>move(g,'repay',loan.id));
});
test('Due loans enter durable debt, can be covered by mortgage and are charged only once',()=>{
  const g=create(),p=g.party;move(g,'loan',-1,{partner:'G',principal:500,interest:10,term:1});move(g,'accept');p.stage='end';move(g,'end');
  const borrower=p.players[1];borrower.position=47;borrower.cash=0;p.property[47]='G';
  const dice=[1,2];vietnamMove(g,{action:'roll',to:-1},()=>dice.shift()||1);assert.equal(borrower.laps,1);assert.equal(p.stage,'debt');assert.equal(p.debt.loanId,p.loans[0].id);
  const before=p.players[0].cash;move(g,'mortgage',47);assert.equal(p.loans[0].status,'repaid');assert.equal(p.players[0].cash,before+550);assert.equal(p.debt,null);assert.equal(p.mortgaged[47],true);
});
test('Auctions rotate bidders, enforce budget/minimum increments and award the highest bid once',()=>{
  const g=create(),p=g.party;p.players[0].position=1;p.stage='buy';move(g,'auction');assert.equal(g.turn,'G');
  assert.throws(()=>move(g,'bid',-1,{amount:9}));assert.throws(()=>move(g,'bid',-1,{amount:100000}));move(g,'bid',-1,{amount:100});assert.equal(g.turn,'R');move(g,'pass_bid');
  assert.equal(p.property[1],'G');assert.equal(p.players[1].cash,2900);assert.equal(g.turn,'R');assert.equal(p.stage,'end');assert.equal(p.auction,null);
});
test('Balanced building reaches hotels, stocks reconcile and mortgaged land earns no rent',()=>{
  const g=create(),p=g.party,group=VN_CELLS.filter(c=>c.type==='property'&&c.group===0);for(const c of group)p.property[c.index]='R';p.players[0].cash=10000;
  const lots=group.map(c=>c.index);move(g,'build',lots[0]);assert.equal(vietnamLegal(g).some(m=>m.action==='build'&&m.to===lots[0]),false);
  for(let level=0;level<5;level++)for(const i of lots)if(p.houses[i]===level)move(g,'build',i);
  assert.ok(lots.every(i=>p.houses[i]===5));assert.equal(p.bank.hotels,16-group.length);assert.equal(p.bank.houses,64);
  move(g,'clear_group',lots[0]);assert.equal(p.bank.hotels,16);assert.ok(lots.every(i=>p.houses[i]===0));
  move(g,'mortgage',lots[0]);assert.equal(vietnamRent(g,lots[0]),0);move(g,'redeem',lots[0]);assert.ok(vietnamRent(g,lots[0])>0);
});
test('Third consecutive double sends to jail; jail can be exited with a card or bail',()=>{
  const g=create(),p=g.party;for(let i=0;i<2;i++){vietnamMove(g,{action:'roll',to:-1},()=>1);p.stage='end';move(g,'end');}
  vietnamMove(g,{action:'roll',to:-1},()=>1);assert.equal(p.players[0].position,12);assert.equal(p.players[0].jail,3);p.stage='roll';p.players[0].jailCards=1;move(g,'jail_card');assert.equal(p.players[0].jail,0);assert.equal(p.players[0].jailCards,0);
});
test('Resignation cancels pending contracts without giving money and redirects insolvent loans correctly',()=>{
  const g=create(),p=g.party;move(g,'loan',-1,{partner:'G',principal:500,interest:5,term:2});eliminateVietnam(g,'R');assert.equal(p.players[1].cash,3000);assert.equal(g.phase,'finished');assert.equal(g.result.winner,'G');
});
test('Bot evaluates received trades and produces server-validated bids',()=>{
  const g=create();move(g,'offer',-1,{partner:'G',pay:100,ask:0,give:[],take:[]});const answer=chooseVietnam(g);assert.equal(answer.action,'accept');makePracticeMove(g,answer);assert.equal(g.turn,'R');
});
test('Monopoly rooms support up to 8 players with unique sides and default to casual mode',async()=>{
  const db=await openDatabase({memory:true}),rooms=new RoomService(db);
  try{
    const users=await Promise.all(Array.from({length:8},()=>createGuest(db)));
    const created=await rooms.create(users[0],60,'monopoly','first',8);
    assert.equal(created.room.ranked,false);
    assert.equal(created.room.capacity,8);
    assert.deepEqual(created.room.game.party.sides,['R','G','Y','B','P','O','C','K']);
    assert.equal(created.room.game.party.bank.houses,96);
    for(let i=1;i<8;i++)await rooms.join(created.room.id,users[i],created.token);
    let room=await rooms.get(created.room.id,users[0].id);
    assert.equal(room.players.length,8);
    assert.deepEqual(room.players.map(p=>p.mark),['R','G','Y','B','P','O','C','K']);
    for(const u of users)room=await rooms.act(room.id,u.id,{actionId:randomUUID(),version:room.version,action:'ready'});
    assert.equal(room.game.phase,'playing');
    assert.equal(room.game.turn,'R');
    const rand=await rooms.create(users[0],60,'monopoly','random',8);
    for(let i=1;i<8;i++)await rooms.join(rand.room.id,users[i],rand.token);
    const randRoom=await rooms.get(rand.room.id,users[0].id);
    assert.deepEqual(randRoom.players.map(p=>p.mark).sort(),['B','C','G','K','O','P','R','Y']);
    await assert.rejects(()=>rooms.create(users[0],60,'monopoly','first',9),/Số người không hợp lệ/);
    await assert.rejects(()=>rooms.create(users[0],5,'ludo','first',5),/Số người không hợp lệ/);
  }finally{rooms.close();await db.close();}
});
