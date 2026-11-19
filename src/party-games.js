import {randomBytes} from 'node:crypto';
import {newVietnam,vietnamLegal,vietnamMove,chooseVietnam,eliminateVietnam,vietnamWealth,VN_EDITION} from './vietnam-estate.js';
export const PARTY_KINDS=['ludo','monopoly'];
export const PARTY_SIDES=['R','G','Y','B'];
export const MONOPOLY_SIDES=['R','G','Y','B','P','O','C','K'];
/** Cryptographically unbiased die roll (1..6) using OS CSPRNG with strict rejection sampling (252 = 6 * 42). */
export function trueRollDie(){
  for(;;){
    const buf=randomBytes(4);
    for(let i=0;i<buf.length;i++){
      if(buf[i]<252)return (buf[i]%6)+1;
    }
  }
}
export const SAFE_LUDO=[0,8,13,21,26,34,39,47];
export const estateCells=Array.from({length:20},(_,i)=>({index:i,name:['Xuất phát','Sen','Trúc','Cơ hội','Mai','Thuế','Đào','Lan','Cơ hội','Cúc','Thăm tù','Sông','Núi','Cơ hội','Biển','Nghỉ chân','Mây','Gió','Cơ hội','Trăng'][i],type:i===0?'start':i===5?'tax':i===10?'jail':i===15?'rest':[3,8,13,18].includes(i)?'chance':'property',price:100+i*20,group:Math.floor((i%5)/2)+Math.floor(i/5)*2}));
// Property groups pair adjacent property spaces on the ring, independent of corners/events.
estateCells.filter(c=>c.type==='property').forEach((c,i)=>c.group=Math.floor(i/2));
export function newParty(kind,count=2,legacy=false,estateMode,seatSides){if(kind==='monopoly'&&!legacy)return newVietnam(count,estateMode,seatSides);return {sides:PARTY_SIDES.slice(0,count),players:PARTY_SIDES.slice(0,count).map(side=>({side,active:true,tokens:[-1,-1,-1,-1],position:0,cash:1500,jail:0})),stage:'roll',dice:null,rolls:0,round:1,property:Array(20).fill(null),houses:Array(20).fill(0),message:'',debt:null};}
const current=game=>game.party.players.find(p=>p.side===game.turn);
function finish(game,winner,reason){game.phase='finished';game.result={winner,reason,line:[],at:Date.now()};}
export function nextPartyTurn(game){
  const p=game.party,active=p.players.filter(v=>v.active);
  if(active.length===1){finish(game,active[0].side,'last-player');return;}
  const at=p.sides.indexOf(game.turn);
  for(let step=1;step<=p.sides.length;step++){const next=p.players[(at+step)%p.sides.length];if(next.active){if((at+step)>=p.sides.length)p.round++;game.turn=next.side;break;}}
  p.stage='roll';p.dice=null;p.debt=null;
  if(game.kind==='monopoly'&&p.round>30){const ranked=active.map(player=>({side:player.side,value:wealth(p,player.side)})).sort((a,b)=>b.value-a.value);finish(game,ranked[0].value===ranked[1]?.value?null:ranked[0].side,'wealth');}
}
export function wealth(p,side){if(p.edition===VN_EDITION)return vietnamWealth(p,side);return p.players.find(v=>v.side===side).cash+p.property.reduce((sum,owner,i)=>sum+(owner===side?estateCells[i].price+p.houses[i]*100:0),0);}
export function eliminateParty(game,side,reason='resign'){
  if(game.party.edition===VN_EDITION)return eliminateVietnam(game,side,reason);
  const p=game.party,player=p.players.find(v=>v.side===side);if(!player?.active)return;
  player.active=false;player.tokens=[-1,-1,-1,-1];
  p.property=p.property.map((owner,i)=>{if(owner!==side)return owner;p.houses[i]=0;return null;});
  const active=p.players.filter(v=>v.active);if(active.length===1){finish(game,active[0].side,reason);return;}
  if(game.turn===side)nextPartyTurn(game);
}
export function ludoDest(p,side,token){
  const player=p.players.find(v=>v.side===side),pos=player.tokens[token];
  return pos===-1?p.dice===6?0:null:pos===57||pos+p.dice>57?null:pos+p.dice;
}
export function partyLegal(game){
  if(game.party.edition===VN_EDITION)return vietnamLegal(game);
  if(game.phase!=='playing')return [];
  const p=game.party,me=current(game);if(!me?.active)return [];
  const option=(action,to=-1)=>({from:null,to,action});
  if(p.stage==='roll')return [option('roll')];
  if(game.kind==='ludo')return me.tokens.flatMap((_,i)=>ludoDest(p,me.side,i)===null?[]:[option('move',i)]);
  const owned=p.property.flatMap((side,i)=>side===me.side?[i]:[]),sales=owned.map(i=>option('sell',i));
  if(p.stage==='debt')return [...sales,option('bankrupt')];
  const moves=[option('end'),...sales];
  if(p.stage==='buy'&&me.cash>=estateCells[me.position].price)moves.unshift(option('buy',me.position));
  for(const i of owned){const group=estateCells.filter(c=>c.type==='property'&&c.group===estateCells[i].group);if(me.cash>=100&&p.houses[i]<3&&group.every(c=>p.property[c.index]===me.side)&&p.houses[i]===Math.min(...group.map(c=>p.houses[c.index])))moves.push(option('build',i));}
  return moves;
}
function pay(game,amount,creditor){
  const p=game.party,me=current(game);
  if(me.cash<amount){p.stage='debt';p.debt={amount,creditor};p.message=`Cần trả ${amount}. Bán tài sản hoặc phá sản.`;return;}
  me.cash-=amount;if(creditor)p.players.find(v=>v.side===creditor).cash+=amount;
}
export function partyMove(game,request,roll=trueRollDie){
  if(game.party.edition===VN_EDITION)return vietnamMove(game,request,roll);
  const p=game.party,me=current(game),action=request.action||'move',to=request.to;
  if(action==='roll'){
    const die=roll();p.dice=die;p.rolls++;p.message=`Gieo được ${die}`;
    if(game.kind==='ludo'){
      p.stage='move';if(!partyLegal(game).length){p.message=`Gieo ${die}, không có nước đi`;nextPartyTurn(game);}return {label:`Gieo ${die}`,die};
    }
    if(me.jail){me.jail--;p.message='Bỏ một lượt ở trạm nghỉ';nextPartyTurn(game);return {label:'Hết lượt trong trạm nghỉ',die};}
    const next=me.position+die;if(next>=20)me.cash+=200;me.position=next%20;p.stage='end';
    const cell=estateCells[me.position];p.message=`Đến ${cell.name}`;
    if(cell.type==='property'){
      const owner=p.property[me.position];if(!owner)p.stage='buy';else if(owner!==me.side){const rent=Math.round(cell.price*.15)*(1+p.houses[me.position]*2);pay(game,rent,owner);if(!p.debt)p.message=`Trả tiền thuê ${rent}`;}
    }else if(cell.type==='tax'){pay(game,120,null);if(!p.debt)p.message='Nộp thuế 120';}
    else if(cell.type==='chance'){
      const card=roll();
      if(card<=2){me.cash+=100;p.message='Cơ hội: nhận 100';}
      else if(card<=4){pay(game,80,null);if(!p.debt)p.message='Cơ hội: trả 80';}
      else if(card===5){me.position=10;me.jail=1;p.message='Đến trạm nghỉ, bỏ lượt kế tiếp';}
      else{me.cash+=200;p.message='Cơ hội: nhận 200';}
      return {label:`Gieo ${die} · ${p.message}`,die,card};
    }
    return {label:`Gieo ${die} · ${p.message}`,die};
  }
  if(game.kind==='ludo'){
    const dest=ludoDest(p,me.side,to),die=p.dice;me.tokens[to]=dest;
    if(dest<52){const global=(dest+PARTY_SIDES.indexOf(me.side)*13)%52;
      if(!SAFE_LUDO.includes(global))for(const opponent of p.players)if(opponent.side!==me.side)opponent.tokens=opponent.tokens.map(pos=>pos>=0&&pos<52&&(pos+PARTY_SIDES.indexOf(opponent.side)*13)%52===global?-1:pos);
    }
    p.message=`Quân ${to+1} ${dest===57?'về đích':dest===0?'xuất chuồng':`đi ${die}`}`;
    if(me.tokens.every(pos=>pos===57))finish(game,me.side,'home');
    else if(die===6){p.stage='roll';p.dice=null;}else nextPartyTurn(game);
    return {label:p.message};
  }
  if(action==='buy'){me.cash-=estateCells[to].price;p.property[to]=me.side;p.stage='end';p.message=`Mua ${estateCells[to].name}`;}
  else if(action==='build'){me.cash-=100;p.houses[to]++;p.message=`Xây nhà tại ${estateCells[to].name}`;}
  else if(action==='sell'){
    me.cash+=Math.floor(estateCells[to].price/2)+p.houses[to]*50;p.property[to]=null;p.houses[to]=0;p.message=`Bán ${estateCells[to].name}`;
    if(p.debt&&me.cash>=p.debt.amount){const debt=p.debt;p.debt=null;p.stage='end';pay(game,debt.amount,debt.creditor);p.message='Đã trả nợ';}
  }else if(action==='bankrupt'){eliminateParty(game,me.side,'bankrupt');p.message='Phá sản';}
  else if(action==='end'){nextPartyTurn(game);p.message='Kết thúc lượt';}
  return {label:p.message};
}
export function chooseParty(game){
  if(game.party.edition===VN_EDITION)return chooseVietnam(game);
  const options=partyLegal(game),p=game.party,me=current(game);
  if(!options.length)return null;
  if(game.kind==='ludo'){
    if(options.length===1)return options[0];
    const myIdx=PARTY_SIDES.indexOf(me.side),die=p.dice||1;
    const enemyGlobals=new Set();
    for(const opp of p.players)if(opp.active&&opp.side!==me.side){
      const oppIdx=PARTY_SIDES.indexOf(opp.side);
      for(const pos of opp.tokens)if(pos>=0&&pos<52)enemyGlobals.add((pos+oppIdx*13)%52);
    }
    const chasedGlobal=g=>{
      if(SAFE_LUDO.includes(g))return 0;
      let threats=0;
      for(let d=1;d<=6;d++)if(enemyGlobals.has((g-d+52)%52))threats++;
      return threats;
    };
    const scoreTokenMove=opt=>{
      const tokenIdx=opt.to,fromPos=me.tokens[tokenIdx],dest=ludoDest(p,me.side,tokenIdx);
      if(dest===null)return -1e9;
      let score=0;
      // 1. Exact home completion
      if(dest===57)score+=500;
      // 2. Entering private home stretch (safe from capture)
      if(fromPos<52&&dest>=52)score+=220;
      // 3. Yard breakout on rolling a 6
      if(fromPos===-1&&dest===0)score+=310;
      // 4. Track tactics (captures, safe stars, escaping pursuit)
      if(dest<52){
        const destGlobal=(dest+myIdx*13)%52;
        if(!SAFE_LUDO.includes(destGlobal)){
          for(const opp of p.players)if(opp.active&&opp.side!==me.side){
            const oppIdx=PARTY_SIDES.indexOf(opp.side);
            for(const op of opp.tokens)if(op>=0&&op<52&&(op+oppIdx*13)%52===destGlobal){
              score+=420+op*4; // Huge bonus for capturing an advanced enemy token
            }
          }
        }
        if(SAFE_LUDO.includes(destGlobal))score+=140;
        score-=chasedGlobal(destGlobal)*55;
      }
      if(fromPos>=0&&fromPos<52){
        const fromGlobal=(fromPos+myIdx*13)%52;
        score+=chasedGlobal(fromGlobal)*65; // Bonus for escaping danger
        if(SAFE_LUDO.includes(fromGlobal)&&dest<52)score-=35; // Slight caution leaving a safe star
      }
      score+=dest*2;
      return score;
    };
    return [...options].sort((a,b)=>scoreTokenMove(b)-scoreTokenMove(a))[0];
  }
  // Mini Monopoly Expectiminimax & Portfolio Strategy
  const rollOpt=options.find(m=>m.action==='roll');if(rollOpt)return rollOpt;
  // Compute maximum potential rent threat on the board to maintain a dynamic cash reserve
  let maxEnemyRent=80;
  for(let i=0;i<20;i++){
    const owner=p.property[i];
    if(owner&&owner!==me.side){
      const rent=Math.round(estateCells[i].price*.15)*(1+p.houses[i]*2);
      if(rent>maxEnemyRent)maxEnemyRent=rent;
    }
  }
  const reserve=game.difficulty==='hard'?Math.max(120,maxEnemyRent):150;
  const buyOpt=options.find(m=>m.action==='buy');
  if(buyOpt){
    const cell=estateCells[buyOpt.to];
    const groupCells=estateCells.filter(c=>c.type==='property'&&c.group===cell.group);
    const completesMonopoly=groupCells.some(c=>c.index!==cell.index&&p.property[c.index]===me.side);
    const blocksOpponentMonopoly=groupCells.some(c=>c.index!==cell.index&&p.property[c.index]&&p.property[c.index]!==me.side);
    if(completesMonopoly||blocksOpponentMonopoly||me.cash-cell.price>=reserve)return buyOpt;
  }
  const buildOpts=options.filter(m=>m.action==='build');
  if(buildOpts.length&&me.cash-100>=reserve+80){
    // Build on the highest-rent property group first
    return buildOpts.sort((a,b)=>estateCells[b.to].price-estateCells[a.to].price)[0];
  }
  if(p.stage==='debt'){
    const sellOpts=options.filter(m=>m.action==='sell');
    if(sellOpts.length){
      // Sell ungrouped / non-monopoly properties with fewest houses first
      return sellOpts.sort((a,b)=>{
        const ga=estateCells.filter(c=>c.type==='property'&&c.group===estateCells[a.to].group);
        const gb=estateCells.filter(c=>c.type==='property'&&c.group===estateCells[b.to].group);
        const monoA=ga.every(c=>p.property[c.index]===me.side)?1:0;
        const monoB=gb.every(c=>p.property[c.index]===me.side)?1:0;
        return monoA-monoB||p.houses[a.to]-p.houses[b.to]||estateCells[a.to].price-estateCells[b.to].price;
      })[0];
    }
  }
  return options.find(m=>m.action==='end')||options[0];
}
