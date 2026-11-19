import config from './vietnam-estate.json' with {type:'json'};
import {GameError} from './game.js';

export const VN_EDITION=config.edition;
export const VN_CELLS=Array.from({length:48},(_,index)=>{
  if(config.specials[index])return {index,...config.specials[index]};
  const ordinal=Array.from({length:index},(_,i)=>i).filter(i=>!config.specials[i]).length,group=Math.min(10,Math.floor(ordinal/3)),price=120+group*50+(ordinal%3)*20;
  return {index,name:config.provinces[ordinal],type:'property',group,price,buildCost:60+group*15,rent:[Math.ceil(price*.08),Math.ceil(price*.4),Math.ceil(price*1.05),Math.ceil(price*2),Math.ceil(price*3),Math.ceil(price*4.2)]};
});
const ownable=c=>['property','station','utility'].includes(c.type);
const alive=p=>p.players.filter(v=>v.active),player=(g,side=g.turn)=>g.party.players.find(v=>v.side===side);
const groupOf=cell=>VN_CELLS.filter(c=>c.type==='property'&&c.group===cell.group);
const option=(action,to=-1)=>({from:null,to,action});
const money=(n,minimum=0,maximum=100000)=>Number.isSafeInteger(n)&&n>=minimum&&n<=maximum;
const demand=(ok,message)=>{if(!ok)throw new GameError(message);};
const ledger=(g,kind,message,amount=0)=>{const p=g.party;p.ledger.push({id:++p.sequence,kind,message,amount,at:Date.now()});p.ledger=p.ledger.slice(-100);p.loans=[...p.loans.filter(l=>['open','due'].includes(l.status)),...p.loans.filter(l=>!['open','due'].includes(l.status)).slice(-20)];p.message=message;};
const emitEvent=(g,ev)=>{const p=g.party;if(!p.events)p.events=[];p.eventSeq=(p.eventSeq||0)+1;p.events.push({id:p.eventSeq,at:Date.now(),...ev});p.events=p.events.slice(-12);};
function finish(g,winner,reason){g.phase='finished';g.result={winner,reason,line:[],at:Date.now()};}
export const VN_SIDES=['R','G','Y','B','P','O','C','K'];
export function newVietnam(count=2){const sides=VN_SIDES.slice(0,count);return {edition:VN_EDITION,sides,players:sides.map(side=>({side,active:true,tokens:[-1,-1,-1,-1],position:0,cash:config.startingCash,jail:0,laps:0,jailCards:0})),stage:'roll',dice:null,diceValues:[],rolls:0,round:1,property:Array(48).fill(null),houses:Array(48).fill(0),mortgaged:Array(48).fill(false),bank:{houses:count>4?96:64,hotels:count>4?24:16},message:'Vốn 3.000 triệu. Tiền trong game.',debt:null,payments:[],resumeStage:'end',doubleCount:0,extraRoll:false,loans:[],pending:null,auction:null,ledger:[],events:[],eventSeq:0,sequence:0};}
export function vietnamWealth(p,side){return player({party:p},side).cash+p.property.reduce((sum,owner,i)=>sum+(owner===side?(VN_CELLS[i].price||0)-(p.mortgaged[i]?Math.floor(VN_CELLS[i].price/2):0)+p.houses[i]*(VN_CELLS[i].buildCost||0):0),0)+p.loans.filter(l=>l.status==='open'&&l.lender===side).reduce((s,l)=>s+l.principal,0)-p.loans.filter(l=>['open','due'].includes(l.status)&&l.borrower===side).reduce((s,l)=>s+l.total,0);}
function settle(g){const p=g.party;while(p.payments.length){const bill=p.payments[0],me=player(g);if(me.cash<bill.amount){p.stage='debt';p.debt=bill;p.message=`Cần trả ${bill.amount} triệu: ${bill.reason}. Thế chấp, bán nhà hoặc thanh lý đất.`;emitEvent(g,{type:'loss',side:me.side,creditor:bill.creditor||null,title:'Thiếu tiền thanh toán',reason:`Cần trả ${bill.amount} tr · ${bill.reason}`,amount:-bill.amount,lot:bill.lot??me.position});return;}me.cash-=bill.amount;const receiver=player(g,bill.creditor);if(receiver?.active)receiver.cash+=bill.amount;if(bill.loanId){const loan=p.loans.find(l=>l.id===bill.loanId);if(loan)loan.status='repaid';}const evType=bill.category==='tax'?'tax':bill.category==='rent'?'rent':'loss';const evTitle=bill.category==='tax'?'Nộp thuế ngân sách':bill.category==='rent'?'Trả tiền thuê đất':bill.category==='card_fee'?'Phí thẻ sự kiện':bill.loanId?'Tất toán khoản vay':'Trừ tiền phạt';emitEvent(g,{type:evType,side:me.side,creditor:bill.creditor||null,title:evTitle,reason:bill.reason,amount:-bill.amount,lot:bill.lot??me.position});ledger(g,'payment',`${me.side} trả ${bill.amount} triệu · ${bill.reason}`,bill.amount);p.payments.shift();}if(p.stage==='debt')p.stage=p.resumeStage;p.debt=null;}
function bill(g,amount,creditor,reason,loanId,category='loss',lot=null){if(amount>0)g.party.payments.push({amount,creditor,reason,category,lot,...(loanId?{loanId}:{})});}
function dueLoans(g){const p=g.party,me=player(g);for(const loan of p.loans)if(loan.status==='open'&&loan.borrower===me.side&&me.laps>=loan.dueLap){loan.status='due';bill(g,loan.total,loan.lender,`Đến hạn vay #${loan.id}`,loan.id,'loan',me.position);}}
function nextTurn(g){const p=g.party,active=alive(p);if(active.length<=1){finish(g,active[0]?.side||null,'last-player');return;}const i=p.sides.indexOf(g.turn);for(let n=1;n<=p.sides.length;n++){const next=p.players[(i+n)%p.sides.length];if(next.active){if(i+n>=p.sides.length)p.round++;g.turn=next.side;break;}}p.stage='roll';p.dice=null;p.diceValues=[];p.doubleCount=0;p.extraRoll=false;p.debt=null;p.payments=[];p.pending=null;p.auction=null;p.loans=p.loans.filter(l=>['open','due'].includes(l.status)).slice(-16);}
function jail(g,reason='Dừng tại ô Vào Trại giam'){const p=g.party,me=player(g);p.movement={side:me.side,from:me.position,to:12,steps:0,teleport:true};me.position=12;me.jail=3;p.extraRoll=false;p.doubleCount=0;p.stage='end';emitEvent(g,{type:'jail',side:me.side,title:'Vào Trại giam!',reason,amount:0,lot:12});ledger(g,'jail',`${me.side} vào tù (${reason}). Có thể trả 100, dùng thẻ hoặc gieo đôi.`);}
export function vietnamRent(g,index,diceTotal=7){const p=g.party,c=VN_CELLS[index],owner=p.property[index];if(!owner||p.mortgaged[index])return 0;if(c.type==='station')return 50*2**(VN_CELLS.filter(c=>c.type==='station'&&p.property[c.index]===owner).length-1);if(c.type==='utility')return diceTotal*(VN_CELLS.filter(c=>c.type==='utility'&&p.property[c.index]===owner).length===2?12:5);return c.rent[p.houses[index]]*(p.houses[index]===0&&groupOf(c).every(v=>p.property[v.index]===owner)?2:1);}
function landing(g,roll,allowCard=true){const p=g.party,me=player(g),c=VN_CELLS[me.position];p.stage='end';p.message=`Đến ${c.name}`;
  if(ownable(c)){const owner=p.property[c.index];if(!owner)p.stage='buy';else if(owner!==me.side)bill(g,vietnamRent(g,c.index,p.diceValues.reduce((a,b)=>a+b,0)),owner,`Thuê ${c.name}`,undefined,'rent',c.index);}
  else if(c.type==='tax')bill(g,c.amount,null,`Nộp ${c.name}`,undefined,'tax',c.index);
  else if(c.type==='gotojail')jail(g,'Dừng tại ô Vào Trại giam');
  else if(allowCard&&['chance','community'].includes(c.type)){
    const card=roll(),deck=c.type,deckName=deck==='chance'?'Cơ hội':'Khí vận';
    if(card===1){me.cash+=200;emitEvent(g,{type:'card',deck,card,side:me.side,title:'Quỹ hỗ trợ phát triển',reason:`Thẻ ${deckName}: nhận thưởng 200 triệu từ quỹ phát triển`,amount:200,lot:c.index});ledger(g,'card','Quỹ hỗ trợ: nhận 200 triệu',200);}
    else if(card===2){emitEvent(g,{type:'card',deck,card,side:me.side,title:'Sửa chữa công trình',reason:`Thẻ ${deckName}: thanh toán 120 triệu phí bảo trì công trình`,amount:-120,lot:c.index});bill(g,120,null,'Sửa chữa công trình',undefined,'card_fee',c.index);}
    else if(card===3){me.jailCards++;emitEvent(g,{type:'card',deck,card,side:me.side,title:'Thẻ Đặc Ân Ra Tù',reason:`Thẻ ${deckName}: nhận 1 thẻ miễn phí rời Trại giam`,amount:0,lot:c.index});ledger(g,'card','Nhận thẻ ra tù');}
    else if(card===4){me.cash+=config.salary;me.laps++;me.position=0;emitEvent(g,{type:'card',deck,card,side:me.side,title:'Tiến thẳng Xuất phát',reason:`Thẻ ${deckName}: về ô Xuất phát & nhận +400 triệu`,amount:config.salary,lot:0});ledger(g,'card','Về Xuất phát, nhận 400 triệu',400);}
    else if(card===5){emitEvent(g,{type:'card',deck,card,side:me.side,title:'Lệnh triệu tập Trại giam',reason:`Thẻ ${deckName}: bị áp giải vào Trại giam ngay lập tức`,amount:0,lot:12});jail(g,`Rút trúng thẻ ${deckName} vào Trại giam`);}
    else{me.position=(me.position+45)%48;emitEvent(g,{type:'card',deck,card,side:me.side,title:'Sự cố hành trình',reason:`Thẻ ${deckName}: lùi 3 ô đến ${VN_CELLS[me.position].name}`,amount:0,lot:me.position});ledger(g,'card',`Lùi 3 ô đến ${VN_CELLS[me.position].name}`);landing(g,roll,false);}
    return card;
  }
}
const freeStage=p=>['roll','buy','end'].includes(p.stage);
const canTrade=(p,i,side)=>Number.isInteger(i)&&ownable(VN_CELLS[i]||{})&&p.property[i]===side&&!p.mortgaged[i]&&(VN_CELLS[i].type!=='property'||groupOf(VN_CELLS[i]).every(c=>p.houses[c.index]===0));
function validateOffer(g,offer){const p=g.party,from=player(g,offer.from),to=player(g,offer.to);demand(from?.active&&to?.active&&from!==to,'Đối tác không còn trong ván.');
  if(offer.kind==='loan'){demand(money(offer.principal,50,2000)&&money(offer.interest,0,20)&&money(offer.term,1,5),'Khoản vay: 50–2.000, lãi 0–20%, hạn 1–5 vòng cá nhân.');demand(from.cash>=offer.principal,'Bên cho vay không đủ tiền.');demand(p.loans.filter(l=>['open','due'].includes(l.status)).length<16,'Tối đa 16 khoản vay đang mở.');}
  else{demand(money(offer.pay)&&money(offer.ask),'Số tiền giao dịch không hợp lệ.');demand(from.cash>=offer.pay&&to.cash>=offer.ask,'Một bên không đủ tiền thực hiện giao dịch.');for(const [list,side]of[[offer.give,from.side],[offer.take,to.side]]){demand(Array.isArray(list)&&list.length<=48&&new Set(list).size===list.length,'Danh sách đất không hợp lệ.');demand(list.every(i=>canTrade(p,i,side)),'Chỉ đổi đất đang sở hữu, không thế chấp và không có nhà trong nhóm.');}demand(offer.pay+offer.ask+offer.give.length+offer.take.length>0,'Giao dịch đang trống.');}
}
function resumeDeal(g){const p=g.party,deal=p.pending;p.pending=null;g.turn=deal.from;p.stage=deal.resume;if(p.stage==='buy'&&p.property[player(g).position])p.stage='end';}
function nextAuction(g){
  const p=g.party,a=p.auction,eligible=alive(p).filter(v=>!a.passed.includes(v.side));
  if((a.leader&&eligible.every(v=>v.side===a.leader))||!eligible.length){
    const original=a.returnSide;
    if(a.leader){
      const buyer=player(g,a.leader);
      if(buyer?.active&&buyer.cash>=a.bid){
        buyer.cash-=a.bid;
        p.property[a.lot]=a.leader;
        p.lastPurchase={lot:a.lot,side:a.leader,price:a.bid,source:'auction',at:Date.now()};
        ledger(g,'auction',`${a.leader} thắng đấu giá ${VN_CELLS[a.lot].name} · ${a.bid} triệu`,a.bid);
      }
      p.auction=null;g.turn=original;p.stage='end';
      if(!player(g)?.active)nextTurn(g);
      return;
    }
    ledger(g,'auction',`Đấu giá ${VN_CELLS[a.lot].name} không có ai mua · Bỏ qua lượt`);
    p.auction=null;g.turn=original;
    nextTurn(g);
    return;
  }
  const at=p.sides.indexOf(g.turn);
  for(let n=1;n<=p.sides.length;n++){
    const side=p.sides[(at+n)%p.sides.length];
    if(eligible.some(v=>v.side===side)&&side!==a.leader){g.turn=side;return;}
  }
}
export function vietnamLegal(g){if(g.phase!=='playing')return [];const p=g.party,me=player(g);if(!me?.active)return [];
  if(p.stage==='deal')return [option('accept'),option('reject')];
  if(p.stage==='auction')return [...(me.cash>=p.auction.bid+10?[option('bid')]:[]),option('pass_bid')];
  const owned=VN_CELLS.filter(c=>p.property[c.index]===me.side),moves=[];
  for(const c of owned){const group=c.type==='property'?groupOf(c):[c],clear=group.every(v=>!p.houses[v.index]);
    if(!p.mortgaged[c.index]&&clear)moves.push(option('mortgage',c.index));
    if(!p.mortgaged[c.index]&&clear)moves.push(option('sell',c.index));
    if(p.houses[c.index]&&p.houses[c.index]===Math.max(...group.map(v=>p.houses[v.index]))&&(p.houses[c.index]<5||p.bank.houses>=4))moves.push(option('sell_building',c.index));
    if(p.houses[c.index])moves.push(option('clear_group',c.index));
    if(freeStage(p)&&p.mortgaged[c.index]&&me.cash>=Math.ceil(c.price*.55))moves.push(option('redeem',c.index));
    if(freeStage(p)&&c.type==='property'&&group.every(v=>p.property[v.index]===me.side&&!p.mortgaged[v.index])&&p.houses[c.index]<5&&p.houses[c.index]===Math.min(...group.map(v=>p.houses[v.index]))&&me.cash>=c.buildCost&&(p.houses[c.index]<4?p.bank.houses>0:p.bank.hotels>0))moves.push(option('build',c.index));
  }
  if(p.stage==='debt')return [...moves,option('bankrupt')];
  if(p.stage==='roll'){moves.unshift(option('roll'));if(me.jail&&me.cash>=100)moves.push(option('pay_jail'));if(me.jail&&me.jailCards)moves.push(option('jail_card'));}
  else if(p.stage==='buy'){if(me.cash>=VN_CELLS[me.position].price)moves.unshift(option('buy',me.position));moves.push(option('auction'),option('skip_buy'));}
  else moves.unshift(option('end'));
  if(freeStage(p)){moves.push(option('gift'),option('offer'),option('loan'));for(const l of p.loans)if(l.status==='open'&&l.borrower===me.side&&me.cash>=l.total)moves.push(option('repay',l.id));}
  return moves;
}
export function vietnamMove(g,request,roll){const p=g.party,me=player(g),action=request.action||'move',to=request.to,d=request.details||{};demand(vietnamLegal(g).some(m=>m.action===action&&m.to===(to??-1)),'Thao tác không hợp lệ ở giai đoạn hiện tại.');
  let die,values,card;
  if(action==='roll'){
    values=[roll(),roll()];demand(values.every(v=>money(v,1,6)),'Xúc xắc không hợp lệ.');die=values[0];p.diceValues=values;p.dice=values.reduce((a,b)=>a+b,0);p.rolls++;const doubles=values[0]===values[1];
    if(me.jail){me.jail--;if(doubles){me.jail=0;p.extraRoll=false;}else if(me.jail>0){p.message=`Không có đôi. Còn ${me.jail} lượt tù.`;nextTurn(g);return {label:p.message,die,dice:values};}else{bill(g,100,null,'Nộp phạt hết 3 lượt tù',undefined,'loss',12);p.extraRoll=false;}}
    else{p.doubleCount=doubles?p.doubleCount+1:0;p.extraRoll=doubles;if(p.doubleCount===3){jail(g,'Gieo 3 đôi liên tiếp');return {label:p.message,die,dice:values};}}
    const origin=me.position,next=origin+p.dice,lapsGained=Math.floor(next/48);me.laps+=lapsGained;if(lapsGained>0){const bonus=lapsGained*config.salary;me.cash+=bonus;emitEvent(g,{type:'salary',side:me.side,title:'Qua ô Xuất phát',reason:`Nhận lương vòng mới +${bonus} triệu`,amount:bonus,lot:0});}me.position=next%48;card=landing(g,roll);p.movement={side:me.side,from:origin,to:me.position,steps:p.dice,teleport:me.position!==next%48};dueLoans(g);p.resumeStage=p.stage;ledger(g,'roll',`${me.side} gieo ${values.join(' + ')} · ${p.message}`);settle(g);
  }else if(action==='buy'){const c=VN_CELLS[to];me.cash-=c.price;p.property[to]=me.side;p.lastPurchase={lot:to,side:me.side,price:c.price,source:'buy',at:Date.now()};p.stage='end';ledger(g,'purchase',`${me.side} mua ${c.name} · ${c.price} triệu`,c.price);}
  else if(action==='skip_buy'){const c=VN_CELLS[me.position];ledger(g,'skip',`${me.side} bỏ qua ${c.name} · Bỏ qua lượt`);nextTurn(g);}
  else if(action==='end'){if(p.extraRoll&&!me.jail){p.stage='roll';p.extraRoll=false;p.dice=null;p.diceValues=[];}else nextTurn(g);}
  else if(action==='pay_jail'||action==='jail_card'){if(action==='pay_jail'){me.cash-=100;emitEvent(g,{type:'loss',side:me.side,title:'Bảo lãnh ra tù',reason:'Nộp 100 triệu rời Trại giam',amount:-100,lot:12});}else me.jailCards--;me.jail=0;ledger(g,'jail',`${me.side} ra tù`);}
  else if(action==='build'){const c=VN_CELLS[to];me.cash-=c.buildCost;p.houses[to]++;if(p.houses[to]===5){p.bank.hotels--;p.bank.houses+=4;}else p.bank.houses--;emitEvent(g,{type:'loss',side:me.side,title:p.houses[to]===5?'Xây Khách sạn':'Xây dựng công trình',reason:`Nâng cấp ${c.name}`,amount:-c.buildCost,lot:to});ledger(g,'build',`${me.side} xây ${p.houses[to]===5?'khách sạn':'nhà'} tại ${c.name}`,c.buildCost);}
  else if(action==='sell_building'){const c=VN_CELLS[to];if(p.houses[to]===5){p.bank.hotels++;p.bank.houses-=4;}else p.bank.houses++;p.houses[to]--;me.cash+=Math.floor(c.buildCost/2);ledger(g,'liquidate',`${me.side} bán một công trình ở ${c.name}`);settle(g);}
  else if(action==='clear_group'){const group=groupOf(VN_CELLS[to]);let refund=0;for(const c of group){const n=p.houses[c.index];refund+=Math.floor(n*c.buildCost/2);if(n===5)p.bank.hotels++;else p.bank.houses+=n;p.houses[c.index]=0;}me.cash+=refund;ledger(g,'liquidate',`${me.side} tháo toàn bộ công trình trong nhóm · ${refund} triệu`,refund);settle(g);}
  else if(action==='mortgage'){const c=VN_CELLS[to],amount=Math.floor(c.price/2);p.mortgaged[to]=true;me.cash+=amount;ledger(g,'mortgage',`${me.side} thế chấp ${c.name} · ${amount} triệu`,amount);settle(g);}
  else if(action==='redeem'){const c=VN_CELLS[to],amount=Math.ceil(c.price*.55);me.cash-=amount;p.mortgaged[to]=false;emitEvent(g,{type:'loss',side:me.side,title:'Chuộc đất thế chấp',reason:`Thanh toán chuộc lại ${c.name}`,amount:-amount,lot:to});ledger(g,'redeem',`${me.side} chuộc ${c.name}`,amount);}
  else if(action==='sell'){const c=VN_CELLS[to],amount=Math.floor(c.price/2);me.cash+=amount;p.property[to]=null;ledger(g,'liquidate',`${me.side} bán ${c.name} cho ngân hàng · ${amount} triệu`,amount);settle(g);}
  else if(action==='gift'){const receiver=player(g,d.partner);demand(receiver?.active&&receiver!==me,'Chọn người nhận đang chơi.');demand(money(d.amount,1)&&me.cash>=d.amount,'Tiền tặng phải là số nguyên dương trong số dư.');me.cash-=d.amount;receiver.cash+=d.amount;emitEvent(g,{type:'loss',side:me.side,creditor:receiver.side,title:'Chuyển tiền tặng',reason:'Tặng tiền cho người chơi khác',amount:-d.amount,lot:me.position});ledger(g,'gift',`${me.side} tặng ${receiver.side} ${d.amount} triệu`,d.amount);}
  else if(action==='offer'||action==='loan'){const offer={id:p.sequence+1,kind:action==='loan'?'loan':'trade',from:me.side,to:d.partner,resume:p.stage,...(action==='loan'?{principal:d.principal,interest:d.interest,term:d.term}:{pay:d.pay,ask:d.ask,give:d.give,take:d.take})};validateOffer(g,offer);p.pending=offer;p.stage='deal';g.turn=offer.to;ledger(g,'offer',`${offer.from} gửi ${offer.kind==='loan'?'hợp đồng vay':'đề nghị trao đổi'} cho ${offer.to}`);}
  else if(action==='accept'||action==='reject'){const offer=p.pending;demand(offer?.to===me.side,'Bạn không phải người nhận đề nghị.');if(action==='accept'){validateOffer(g,offer);const from=player(g,offer.from);if(offer.kind==='loan'){from.cash-=offer.principal;me.cash+=offer.principal;p.loans.push({id:offer.id,lender:from.side,borrower:me.side,principal:offer.principal,total:offer.principal+Math.ceil(offer.principal*offer.interest/100),interest:offer.interest,dueLap:me.laps+offer.term,status:'open'});}else{from.cash+=offer.ask-offer.pay;me.cash+=offer.pay-offer.ask;for(const i of offer.give)p.property[i]=me.side;for(const i of offer.take)p.property[i]=from.side;}ledger(g,'contract',`${me.side} chấp nhận đề nghị #${offer.id}`);}else ledger(g,'reject',`${me.side} từ chối đề nghị #${offer.id}`);resumeDeal(g);}
  else if(action==='repay'){const loan=p.loans.find(l=>l.id===to&&l.borrower===me.side&&l.status==='open');demand(loan&&me.cash>=loan.total,'Không đủ tiền trả khoản vay.');me.cash-=loan.total;const lender=player(g,loan.lender);if(lender?.active)lender.cash+=loan.total;loan.status='repaid';emitEvent(g,{type:'loss',side:me.side,creditor:loan.lender||null,title:'Tất toán khoản vay',reason:`Trả sớm khoản vay #${loan.id}`,amount:-loan.total,lot:me.position});ledger(g,'repay',`${me.side} tất toán vay #${loan.id} · ${loan.total} triệu`,loan.total);}
  else if(action==='auction'){p.auction={lot:me.position,bid:0,leader:null,passed:[],returnSide:me.side,history:[]};p.stage='auction';ledger(g,'auction',`Mở đấu giá ${VN_CELLS[me.position].name}`);nextAuction(g);}
  else if(action==='bid'){const a=p.auction;demand(money(d.amount,a.bid+10)&&d.amount<=me.cash,'Giá đấu phải cao hơn ít nhất 10 và không vượt số dư.');a.bid=d.amount;a.leader=me.side;(a.history||=[]).push({side:me.side,action:'bid',amount:d.amount,at:Date.now()});ledger(g,'bid',`${me.side} đấu ${d.amount} triệu cho ${VN_CELLS[a.lot].name}`,d.amount);nextAuction(g);}
  else if(action==='pass_bid'){p.auction.passed.push(me.side);(p.auction.history||=[]).push({side:me.side,action:'pass',at:Date.now()});nextAuction(g);}
  else if(action==='bankrupt')eliminateVietnam(g,me.side,'bankrupt');
  return {label:p.message,...(die?{die,dice:values}:{}),...(card?{card}:{})};
}
export function eliminateVietnam(g,side,reason='resign'){const p=g.party,me=player(g,side);if(!me?.active)return;const creditor=g.turn===side?p.debt?.creditor:null,receiver=player(g,creditor);if(receiver?.active){receiver.cash+=me.cash;for(let i=0;i<48;i++)if(p.property[i]===side)p.property[i]=receiver.side;}else for(let i=0;i<48;i++)if(p.property[i]===side){if(p.houses[i]===5)p.bank.hotels++;else p.bank.houses+=p.houses[i];p.property[i]=null;p.houses[i]=0;p.mortgaged[i]=false;}me.cash=0;me.active=false;for(const l of p.loans){if(l.borrower===side&&['open','due'].includes(l.status))l.status='defaulted';if(l.lender===side)l.lender=null;}ledger(g,'bankrupt',`${side} rời ván · ${reason}`);
  if(alive(p).length<=1){finish(g,alive(p)[0]?.side||null,reason);return;}
  if(p.pending&&(p.pending.from===side||p.pending.to===side)){const owner=p.pending.from;resumeDeal(g);if(owner===side)nextTurn(g);return;}
  if(p.auction){if(p.auction.leader===side){p.auction.leader=null;p.auction.bid=0;}if(!p.auction.passed.includes(side))p.auction.passed.push(side);if(g.turn===side)nextAuction(g);return;}
  if(g.turn===side)nextTurn(g);
}
export function timeoutVietnamTurn(g){
  const p=g.party,me=player(g);if(!me?.active)return;
  if(p.stage==='auction'&&p.auction){
    p.auction.passed.push(me.side);
    (p.auction.history||=[]).push({side:me.side,action:'pass',at:Date.now()});
    ledger(g,'timeout',`${me.side} hết 30s · Tự động bỏ qua đấu giá`);
    nextAuction(g);
    return;
  }
  if(p.stage==='deal'&&p.pending){
    ledger(g,'timeout',`${me.side} hết 30s · Tự động từ chối đề nghị #${p.pending.id}`);
    resumeDeal(g);
    return;
  }
  if(p.stage==='debt'){
    eliminateVietnam(g,me.side,'timeout');
    return;
  }
  ledger(g,'timeout',`${me.side} hết 30s · Tự động qua lượt`);
  nextTurn(g);
}
export function chooseVietnam(g){const opts=vietnamLegal(g),p=g.party,me=player(g);if(!opts.length)return null;const find=a=>opts.find(m=>m.action===a);if(find('accept')){const d=p.pending;let fair=false;try{validateOffer(g,d);fair=d.kind==='loan'?d.interest<=10&&d.term>=2:d.pay+d.take.reduce((s,i)=>s+(VN_CELLS[i].price||0),0)>=d.ask+d.give.reduce((s,i)=>s+(VN_CELLS[i].price||0),0); // Recomputed below from the receiver's perspective.
    if(d.kind==='trade')fair=d.pay+d.give.reduce((s,i)=>s+VN_CELLS[i].price,0)>=d.ask+d.take.reduce((s,i)=>s+VN_CELLS[i].price,0);
  }catch{}return find(fair?'accept':'reject');}
  if(find('bid'))return p.auction.bid+10<=Math.min(me.cash-200,Math.floor(VN_CELLS[p.auction.lot].price*.95))?{...find('bid'),details:{amount:p.auction.bid+10}}:find('pass_bid');
  if(find('roll'))return find('pay_jail')||find('jail_card')||find('roll');
  if(p.stage==='debt')return find('sell_building')||find('clear_group')||find('mortgage')||find('sell')||find('bankrupt');
  if(find('buy')&&me.cash-VN_CELLS[me.position].price>=200)return find('buy');if(find('auction'))return find('auction');
  const build=find('build');if(build&&me.cash-VN_CELLS[build.to].buildCost>=400)return build;
  return find('end')||find('repay')||opts.find(m=>!['gift','offer','loan'].includes(m.action))||null;
}
