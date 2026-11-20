import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newVietnam,startVietnam,vietnamMove,vietnamLegal,eliminateVietnam,VN_CELLS} from '../src/vietnam-estate.js';
import {newGame,applyAction,clockDeadline} from '../src/room-game.js';
import {createPractice,endPractice} from '../src/practice-engine.js';

const make=(count=3,mode='auto')=>{const g={kind:'monopoly',phase:'playing',turn:'R',party:newVietnam(count,mode)};startVietnam(g,()=>0);return g;};
const move=(g,action,to=-1,details={})=>vietnamMove(g,{action,to,details},()=>1);
const readyRoom=()=>{
  const owner={id:'a',mark:'R',ready:true},guests=[{id:'b',mark:'G',ready:true},{id:'c',mark:'Y',ready:true}];
  const room={kind:'monopoly',duration:3600000,capacity:3,estateMode:'auto',owner,players:[owner,...guests],game:newGame(3600000,'clock','monopoly',3,'auto')};
  applyAction(room,'a','start',{},1000,'next');return room;
};

test('A current player resigning without a creditor releases their land and returns buildings to the bank',()=>{
  const g=make(),p=g.party;p.property.fill(null);p.property[1]='R';p.houses[1]=3;p.bank.houses-=3;
  eliminateVietnam(g,'R');assert.equal(p.players[0].active,false);assert.equal(p.property[1],null);assert.equal(p.houses[1],0);assert.equal(p.bank.houses,64);assert.equal(g.turn,'G');
});

test('A non-current player resigning does not renew the current player turn deadline',()=>{
  const room=readyRoom(),g=room.game;const before=clockDeadline(g);
  applyAction(room,'c','resign',{},11000,'next');assert.equal(g.turn,'R');assert.equal(g.matchDeadline,3601000);assert.equal(g.turnStartedAt,11000);assert.equal(clockDeadline(g),before);
});

test('An auction observer resigning preserves bidder deadline; cancelling their deal gives the resumed turn fresh time',()=>{
  const room=readyRoom(),g=room.game,p=g.party;p.property[1]=null;p.players[0].position=1;p.stage='buy';
  applyAction(room,'a','move',{action:'auction',from:null,to:-1},2000,'next');const before=clockDeadline(g);assert.equal(g.turn,'G');
  applyAction(room,'c','resign',{},12000,'next');assert.equal(g.turn,'G');assert.equal(p.stage,'auction');assert.equal(clockDeadline(g),before);
  const other=readyRoom();applyAction(other,'a','move',{action:'offer',from:null,to:-1,details:{partner:'G',pay:1,ask:0,give:[],take:[]}},2000,'next');
  applyAction(other,'b','resign',{},12000,'next');assert.equal(other.game.turn,'R');assert.equal(other.game.party.stage,'roll');assert.equal(clockDeadline(other.game),42000);
});

test('The last opponent resigning during an auction or contract closes transient decisions',()=>{
  for(const phase of ['auction','deal']){
    const g=make(2),p=g.party;
    if(phase==='auction'){p.players[0].position=1;p.property[1]=null;p.stage='buy';move(g,'auction');}
    else move(g,'offer',-1,{partner:'G',pay:1,ask:0,give:[],take:[]});
    const before=p.players[0].cash;eliminateVietnam(g,'G');
    assert.equal(g.phase,'finished');assert.equal(g.result.winner,'R');assert.equal(p.stage,'finished');assert.equal(p.auction,null);assert.equal(p.pending,null);assert.equal(p.debt,null);assert.deepEqual(p.payments,[]);assert.equal(p.players[0].cash,before);assert.deepEqual(vietnamLegal(g),[]);
  }
});

test('Forced end of practice also clears unfinished property decisions',()=>{
  const g=createPractice('monopoly','R','medium','close-practice',{estateMode:'auto'}),p=g.party;p.property[1]=null;p.players[0].position=1;p.stage='buy';move(g,'auction');
  endPractice(g,'G','resign');assert.equal(p.stage,'finished');assert.equal(p.auction,null);assert.equal(p.pending,null);
});

test('Seeded adversarial actions and resignations preserve live actors, stock and atomic contracts',t=>{
  let actions=0;
  for(let count=2;count<=8;count++)for(let seed=1;seed<=35;seed++){
    let x=seed*7919+count;const rnd=n=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return (x>>>8)%n;};
    const g=make(count,seed%2?'auto':'classic'),p=g.party,totalHouses=p.bank.houses,totalHotels=p.bank.hotels;
    for(let step=0;step<1800&&g.phase==='playing';step++){
      const me=p.players.find(player=>player.side===g.turn),others=p.players.filter(player=>player.active&&player!==me),partner=others[rnd(others.length)];
      const tradable=(side)=>VN_CELLS.filter(c=>p.property[c.index]===side&&!p.mortgaged[c.index]&&(c.type!=='property'||VN_CELLS.filter(v=>v.type==='property'&&v.group===c.group&&p.property[v.index]===side).every(v=>!p.houses[v.index]))).map(c=>c.index);
      if(step>0&&step%71===0){eliminateVietnam(g,p.players.filter(player=>player.active)[rnd(p.players.filter(player=>player.active).length)].side);}
      else {
        const legal=vietnamLegal(g).filter(m=>m.action!=='gift'||me.cash>0).filter(m=>m.action!=='loan'||me.cash>=50).filter(m=>m.action!=='offer'||me.cash>0||partner.cash>0||tradable(me.side).length||tradable(partner.side).length);
        assert.ok(legal.length,`No choices: ${count}/${seed}/${step}/${p.stage}`);
        const request={...legal[rnd(legal.length)]};
        if(request.action==='gift')request.details={partner:partner.side,amount:Math.min(me.cash,1+rnd(100))};
        if(request.action==='loan')request.details={partner:partner.side,principal:50,interest:10,term:1};
        if(request.action==='offer')request.details={partner:partner.side,pay:Math.min(me.cash,1),ask:Math.min(partner.cash,1),give:tradable(me.side).slice(0,1),take:tradable(partner.side).slice(0,1)};
        if(request.action==='counter_offer')request.details={pay:p.pending.ask,ask:p.pending.pay,give:p.pending.take,take:p.pending.give};
        if(request.action==='bid')request.details={amount:p.auction.bid+10};
        vietnamMove(g,request,()=>1+rnd(6));actions++;
      }
      for(const player of p.players)assert.ok(Number.isSafeInteger(player.cash)&&player.cash>=0);
      assert.equal(p.bank.houses+p.houses.reduce((sum,n)=>sum+(n===5?0:n),0),totalHouses);assert.equal(p.bank.hotels+p.houses.filter(n=>n===5).length,totalHotels);
      for(let i=0;i<48;i++){if(p.property[i])assert.ok(p.players.find(player=>player.side===p.property[i])?.active,`Inactive owner: count=${count}, seed=${seed}, step=${step}, lot=${i}, owner=${p.property[i]}, turn=${g.turn}, stage=${p.stage}`);else {assert.equal(p.houses[i],0);assert.equal(p.mortgaged[i],false);}}
      if(g.phase==='playing'){
        assert.ok(p.players.find(player=>player.side===g.turn)?.active);
        if(p.stage==='deal'){assert.equal(g.turn,p.pending.to);assert.ok(p.players.find(player=>player.side===p.pending.from)?.active);}
        if(p.stage==='auction'){assert.notEqual(g.turn,p.auction.leader);assert.equal(p.auction.passed.includes(g.turn),false);}
        if(p.stage==='debt'){assert.equal(p.debt,p.payments[0]);assert.ok(p.debt.amount>me.cash);}
      }
    }
    assert.equal(g.phase,'finished',`Nonterminating ${count}/${seed}`);
  }
  t.diagnostic(`245 games with mixed trades, loans, liquidations and resignations; ${actions} actions`);
});
