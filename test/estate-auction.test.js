import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newVietnam,VN_CELLS,vietnamMove,vietnamLegal,chooseVietnam,eliminateVietnam,timeoutVietnamTurn} from '../src/vietnam-estate.js';

const move=(g,action,amount)=>vietnamMove(g,{action,to:-1,details:{amount}},()=>1);
const open=(lot=1,count=3,mode)=>{
  const g={kind:'monopoly',phase:'playing',turn:'R',party:newVietnam(count,mode)};
  g.party.players[0].position=lot;g.party.stage='buy';move(g,'auction');return g;
};
const canBid=g=>vietnamLegal(g).some(m=>m.action==='bid');

test('Auctions start above the base price for land, stations and utilities in every mode',()=>{
  for(const mode of [undefined,'auto','classic'])for(const type of ['property','station','utility']){
    const cell=VN_CELLS.find(c=>c.type===type),g=open(cell.index,3,mode),p=g.party;
    assert.equal(p.auction.bid,cell.price);
    const before=structuredClone(p);
    for(const invalid of [0,10,cell.price,cell.price+9,cell.price+10.5,NaN,Infinity,100001]){
      assert.throws(()=>move(g,'bid',invalid));assert.deepEqual(p,before);
    }
    move(g,'bid',cell.price+10);assert.equal(p.auction.bid,cell.price+10);
    assert.throws(()=>move(g,'bid',cell.price+19));
    move(g,'bid',cell.price+20);assert.equal(p.auction.bid,cell.price+20);
  }
});

test('Only the winner pays the entire base price plus premium to the bank, once',()=>{
  const g=open(),p=g.party,base=VN_CELLS[1].price,before=p.players.map(v=>v.cash);
  move(g,'bid',base+50);move(g,'bid',base+100);
  assert.deepEqual(p.players.map(v=>v.cash),before,'No money changes hands while bidding');
  move(g,'pass_bid');move(g,'pass_bid');
  assert.equal(p.property[1],'Y');assert.equal(p.lastPurchase.price,base+100);
  assert.deepEqual(p.players.map(v=>v.cash),[before[0],before[1],before[2]-base-100]);
  const payment=p.events.at(-1);
  assert.equal(payment.creditor,null);assert.equal(payment.side,'Y');assert.equal(payment.amount,-base-100);
  assert.match(payment.reason,/Nộp ngân hàng/);assert.match(p.message,/nộp ngân hàng/);
  assert.equal(p.auction,null);assert.throws(()=>move(g,'bid',base+110));
  assert.deepEqual(p.players.map(v=>v.cash),[before[0],before[1],before[2]-base-100]);
});

test('Bid affordability includes the base price and allows spending the exact remaining balance',()=>{
  const g=open(),p=g.party,base=VN_CELLS[1].price;
  p.players[1].cash=base+9;assert.equal(canBid(g),false);assert.throws(()=>move(g,'bid',base+10));
  p.players[1].cash=base+10;assert.equal(canBid(g),true);move(g,'bid',base+10);
  move(g,'pass_bid');move(g,'pass_bid');assert.equal(p.players[1].cash,0);assert.equal(p.property[1],'G');
});

test('No bids or timed out bids leave the bank lot and every balance unchanged',()=>{
  const g=open(),p=g.party,before=p.players.map(v=>v.cash);
  while(p.stage==='auction')timeoutVietnamTurn(g);
  assert.equal(p.property[1],null);assert.equal(p.lastPurchase,undefined);assert.deepEqual(p.players.map(v=>v.cash),before);
});

test('Eliminating the leader resets bidding to the base price, never to a discounted price',()=>{
  const g=open(1,4),p=g.party,base=VN_CELLS[1].price;
  move(g,'bid',base+100);eliminateVietnam(g,'G');
  assert.equal(p.auction.leader,null);assert.equal(p.auction.bid,base);
  assert.throws(()=>move(g,'bid',10));move(g,'bid',base+10);
  while(p.stage==='auction')move(g,'pass_bid');assert.equal(p.property[1],'Y');
});

test('Bots bid above the base price with a reserve and pass when the premium is too high',()=>{
  const g=open(),base=VN_CELLS[1].price;
  const bid=chooseVietnam(g);assert.equal(bid.action,'bid');assert.equal(bid.details.amount,base+10);
  vietnamMove(g,bid,()=>1);move(g,'bid',base+100);
  assert.equal(chooseVietnam(g).action,'pass_bid');
});
