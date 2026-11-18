// Cờ tư lệnh: chế độ Tổng lực do Nguyễn Quý Hải công bố. Tham khảo COMMANDER.md.
export const CTL_COLS=11,CTL_ROWS=12;
export const COMMANDER_RULE='commander-total-v2';
export const COMMANDER_DURATION_MS=30*60_000;
export const CTL_VALUES={K:1000,I:10,E:10,T:20,A:10,P:30,M:20,F:40,N:80,H:10,D:10};
const notation={K:'★',I:'B',E:'C',T:'T',A:'F',P:'P',M:'L',F:'K',N:'H',H:'S',D:'D'};
const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
export const ctlUnits=cell=>cell?cell.split('+'):[];
const pack=units=>units.length?units.join('+'):null;
const type=unit=>unit?.[1],hero=unit=>unit?.endsWith('*'),other=side=>side==='r'?'b':'r';
const row=i=>Math.floor(i/11),col=i=>i%11;
const at=(r,c)=>r>=0&&r<12&&c>=0&&c<11?r*11+c:-1;
const heavy=t=>['A','P','M'].includes(t);
export const ctlNaval=i=>col(i)<=2||[5,6].includes(row(i))&&col(i)<5;
const land=i=>col(i)>=2;
export const ctlCoordinate=i=>`${11-row(i)},${col(i)}`;
export function initialCommander(){
  const board=Array(132).fill(null);
  const setup=[
    [0,6,'K'],
    [1,1,'N'],[1,4,'F'],[1,5,'H'],[1,7,'H'],[1,8,'F'],
    [2,3,'P'],[2,6,'M'],[2,9,'P'],
    [3,2,'N'],[3,4,'A'],[3,5,'T'],[3,7,'T'],[3,8,'A'],
    [4,2,'I'],[4,3,'E'],[4,6,'D'],[4,9,'E'],[4,10,'I'],
  ];
  for(const [y,x,t]of setup){board[(11-y)*11+x]='r'+t;board[y*11+x]='b'+t;}
  return board;
}
function route(from,to){
  const dr=row(to)-row(from),dc=col(to)-col(from);
  if(!(dr||dc)||dr&&dc&&Math.abs(dr)!==Math.abs(dc))return null;
  return Array.from({length:Math.max(Math.abs(dr),Math.abs(dc))},(_,i)=>at(row(from)+Math.sign(dr)*(i+1),col(from)+Math.sign(dc)*(i+1)));
}
function range(unit,diagonal,capture){
  const t=type(unit),bonus=hero(unit)?1:0;
  if(t==='H')return 0;
  if(t==='K')return diagonal?(bonus?2:0):capture?1+bonus:11;
  const base={I:1,E:1,A:1,D:1,T:2,P:3,M:2,F:4,N:4}[t]||0;
  if(diagonal&&!['D','P','M','F','N'].includes(t)&&!bonus)return 0;
  return (diagonal&&t==='M'?1:base)+bonus;
}
function crossesDeep(path,from,original){
  let previous=from;
  for(const next of path){if((row(previous)===5&&row(next)===6||row(previous)===6&&row(next)===5)&&(![5,7].includes(col(previous))||original&&col(next)!==col(previous)))return true;previous=next;}
  return false;
}
function canCarry(carrier,passengers,index){
  const t=type(carrier);
  if(t==='H')return passengers.length===1&&type(passengers[0])==='K';
  if(t==='E')return [5,6].includes(row(index))&&passengers.length===1&&heavy(type(passengers[0]));
  const allowed=t==='T'?['K','I','D']:t==='F'?['K','I','D','T']:t==='N'?['K','I','D','T','F']:[];
  return passengers.length<=2&&passengers.every(p=>allowed.includes(type(p)));
}
function airZones(board,enemy){
  return board.flatMap((cell,index)=>ctlUnits(cell).filter(u=>u[0]===enemy&&['A','M','N'].includes(type(u))).map(u=>({index,radius:(type(u)==='M'?2:1)+(hero(u)?1:0)})));
}
const inZone=(i,z)=>(row(i)-row(z.index))**2+(col(i)-col(z.index))**2<=z.radius**2;
function blocked(board,path,unit,from,capture,original=false){
  const t=type(unit);
  if(t==='F'||t==='P'&&capture)return false;
  const alongCoast=col(from)===2&&path.every(p=>col(p)===2);
  return path.slice(0,-1).some(i=>{
    if(!board[i])return false;
    // At the coast, ships and land forces use separate lanes.
    if(t==='N'&&(!original||alongCoast))return ctlUnits(board[i]).some(u=>type(u)==='N');
    return !(t!=='N'&&alongCoast&&type(ctlUnits(board[i])[0])==='N');
  });
}
function rawMoves(board,side,original=false){
  const moves=[];
  for(let from=0;from<132;from++){
    const units=ctlUnits(board[from]);if(!units.length||units[0][0]!==side)continue;
    units.forEach((unit,unitIndex)=>{
      const t=type(unit);if(t==='H')return;
      for(const [dr,dc]of dirs)for(let distance=1;distance<=11;distance++){
        const to=at(row(from)+dr*distance,col(from)+dc*distance);if(to<0)break;
        const target=ctlUnits(board[to]),friendly=target[0]?.[0]===side,capture=!!target.length&&!friendly;
        const path=route(from,to),diagonal=!!(dr&&dc);
        const facing=t==='K'&&capture&&target[0]===other(side)+'K'&&!diagonal&&!blocked(board,path,unit,from,true);
        if(distance>range(unit,diagonal,capture)&&!facing)continue;
        const shipArtillery=t==='N'&&capture&&type(target[0])!=='N'&&!target.some(u=>type(u)==='F');
        if(!(original&&shipArtillery)&&blocked(board,path,unit,from,capture,original))continue;
        // A carrier's base moves the entire stack. Passengers may disembark separately.
        const cargo=unitIndex===0?units.slice(1):[],movers=[unit,...cargo];
        if(friendly){
          const incoming=unitIndex===0?units:[unit];
          if(canCarry(target[0],[...target.slice(1),...incoming],to)&&(!['N','H'].includes(type(target[0]))||land(from))&&!(t==='N'))moves.push({from,to,action:`ctl-${unitIndex}-board`});
          continue;
        }
        if(t==='N'){
          if(capture&&type(target[0])!=='N'){
            if(target.some(u=>type(u)==='F')&&(row(to)-row(from))**2+(col(to)-col(from))**2>(1+(hero(unit)?1:0))**2)continue;
            if(distance>(target.some(u=>type(u)==='F')?1:3)+(hero(unit)?1:0))continue;
            if(col(to)>2){moves.push({from,to,action:`ctl-${unitIndex}-fire`});continue;}
          }
          if(!path.every(ctlNaval))continue;
          // An engineer may only carry its heavy passenger across the river.
        }else if(t==='E'&&cargo.length){
          if(dc!==0||distance!==1||![5,6].includes(row(from))||row(to)!==11-row(from))continue;
        }else if(t!=='F'){
          if(capture&&(!land(to)||original&&type(target[0])==='N')){
            if(original&&type(target[0])!=='N')continue;
            moves.push({from,to,action:`ctl-${unitIndex}-fire`});continue;
          }
          if(!path.every(land))continue;
          if(heavy(t)&&!capture&&crossesDeep(path,from,original))continue;
        }
        if(t==='F'){
          // A bombing run may return to its carrier/airport; an air-to-air capture must land.
          if(capture&&!target.some(u=>type(u)==='F'))moves.push({from,to,action:`ctl-${unitIndex}-bomb`});
          if(!land(to))continue;
        }
        if(movers.length&&(!capture||target[0][0]!==side))moves.push({from,to,action:`ctl-${unitIndex}-move`});
      }
    });
  }
  return moves;
}
function commanderAt(board,side){return board.findIndex(cell=>ctlUnits(cell).some(u=>u===side+'K'||u===side+'K*'));}
function aircraftStrike(from,to,capture,zones){
  const path=route(from,to);
  const intercepted=path.slice(0,-1).some(i=>zones.some(z=>inZone(i,z)&&!(capture&&inZone(to,z))));
  const exchange=!intercepted&&zones.some(z=>inZone(to,z));
  return {burnt:intercepted||exchange&&!capture,exchange};
}
export function commanderThreats(board,side,original=false){
  const king=commanderAt(board,side);if(king<0)return [];
  const zones=original?airZones(board,side):[];
  return rawMoves(board,other(side),original).filter(m=>{
    if(m.to!==king||m.action.endsWith('-board'))return false;
    const attacker=ctlUnits(board[m.from])[Number(m.action.split('-')[1])];
    return !original||type(attacker)!=='F'||hero(attacker)||!aircraftStrike(m.from,king,true,zones).burnt;
  });
}
export function commanderLegal(game){
  if(game.rules===COMMANDER_RULE)return rawMoves(game.board,game.turn,true);
  return rawMoves(game.board,game.turn).filter(move=>{
    const unit=ctlUnits(game.board[move.from])[Number(move.action.split('-')[1])];
    if(type(unit)!=='K'||move.action.endsWith('-board'))return true;
    // A commander on foot cannot travel through enemy-controlled intersections.
    const path=route(move.from,move.to);
    return path.every(to=>{const b=[...game.board];b[move.from]=pack(ctlUnits(b[move.from]).filter(u=>u!==unit));if(ctlUnits(b[move.to]).some(u=>type(u)==='K'))b[move.to]=null;b[to]=unit;return commanderThreats(b,game.turn).length===0;});
  });
}
function decode(move){const m=/^ctl-([0-2])-(move|bomb|fire|board)$/.exec(move.action||'');return m?{unit:+m[1],mode:m[2],to:move.to}:null;}
function promoteLast(board){
  for(const side of['r','b']){
    const troops=[];board.forEach((cell,index)=>ctlUnits(cell).forEach((unit,slot)=>{if(unit[0]===side&&!['K','H'].includes(type(unit)))troops.push({index,slot,unit});}));
    if(troops.length===1&&!hero(troops[0].unit)){const p=troops[0],units=ctlUnits(board[p.index]);units[p.slot]+='*';board[p.index]=pack(units);}
  }
}
export function commanderMove(game,request){
  const legal=commanderLegal(game),{from,to}=request;
  const originalRules=game.rules===COMMANDER_RULE;
  const capturePoints=unit=>originalRules&&type(unit)==='K'?0:CTL_VALUES[type(unit)]+(hero(unit)?10:0);
  let orders;
  if(request.action==='ctl-combined'){
    const incoming=request.details?.orders;
    if(!Array.isArray(incoming)||incoming.length<2||incoming.length>3||incoming.some(o=>!o||!Number.isInteger(o.unit)||!Number.isInteger(o.to)||typeof o.mode!=='string'))return null;
    orders=incoming.map(o=>({unit:o.unit,to:o.to,mode:o.mode}));
    if(to!==orders[0].to||new Set(orders.map(o=>o.unit)).size!==orders.length||new Set(orders.map(o=>o.to)).size!==orders.length)return null;
    if(originalRules&&new Set(orders.map(o=>`${Math.sign(row(o.to)-row(from))},${Math.sign(col(o.to)-col(from))}`)).size!==orders.length)return null;
  }else{const one=decode(request);if(!one)return null;orders=[one];}
  if(request.promotion||request.pass||orders.some(o=>!legal.some(m=>m.from===from&&m.to===o.to&&m.action===`ctl-${o.unit}-${o.mode}`)))return null;
  const original=game.board,units=ctlUnits(original[from]),side=game.turn,enemy=other(side);
  if(!units.length||units[0][0]!==side)return null;
  const next=[...original],zones=airZones(original,enemy),deploying=new Set(orders.map(o=>o.unit)),captures=[],destroyed=[],effects=[];
  const standing=units.filter((_,i)=>!deploying.has(i));
  // An unmoved passenger rides with the base; a bomber/fire action keeps its stack at origin.
  const baseOrder=orders.find(o=>o.unit===0),baseLeaves=baseOrder&&['move','board'].includes(baseOrder.mode);
  if(baseLeaves&&orders.some(o=>o.unit!==0&&['bomb','fire'].includes(o.mode)))return null;
  next[from]=baseLeaves?null:pack(standing);
  let points=0,enemyPoints=0;
  for(const order of orders){
    const {unit:slot,to:dest,mode}=order,unit=units[slot],t=type(unit);
    const carried=slot===0?units.filter((_,i)=>i>0&&!deploying.has(i)):[],moving=[unit,...carried];
    const target=ctlUnits(original[dest]),capture=target.length&&target[0][0]===enemy;
    let burnt=false,exchange=false;
    if(t==='F'&&!hero(unit)){
      ({burnt,exchange}=aircraftStrike(from,dest,capture,zones));
    }
    if(capture&&!burnt){
      captures.push(dest);points+=target.reduce((n,u)=>n+capturePoints(u),0);next[dest]=null;
    }
    if(burnt||exchange){
      destroyed.push(...moving);enemyPoints+=moving.reduce((n,u)=>n+capturePoints(u),0);
      effects.push({from,to:dest,unit,mode,burnt:true});continue;
    }
    if(mode==='bomb'||mode==='fire'){
      // Reconstruct the returning unit in its original order below.
    }else if(mode==='board'){
      const destination=ctlUnits(next[dest]);
      if(!destination.length||!canCarry(destination[0],[...destination.slice(1),...moving],dest))return null;
      next[dest]=pack([...destination,...moving]);
    }else{
      if(next[dest]&&ctlUnits(next[dest])[0][0]===side)return null;
      next[dest]=pack(moving);
    }
    effects.push({from,to:dest,unit,mode,burnt:false});
  }
  if(!baseLeaves){
    // Keep original stack order for units that did not leave or survived a ranged attack.
    const baseBurnt=effects.some(e=>e.unit===units[0]&&e.burnt&&baseOrder?.to===e.to);
    next[from]=pack(units.filter((unit,i)=>{
      if(i>0&&!deploying.has(i)&&baseBurnt)return false;
      const order=orders.find(o=>o.unit===i);return !order||['bomb','fire'].includes(order.mode)&&!effects.find(e=>e.unit===unit&&e.to===order.to)?.burnt;
    }));
  }
  const oldKing=commanderAt(original,side),newKing=commanderAt(next,side);
  // A checking piece earns its star only when the threatened commander actually moves away.
  if(oldKing!==newKing)for(const pending of game.commander?.pending||[]){
    if(pending.against!==side)continue;const stack=ctlUnits(next[pending.index]);
    if(stack[pending.slot]===pending.unit&&!hero(pending.unit)){stack[pending.slot]+='*';next[pending.index]=pack(stack);}
  }
  promoteLast(next);
  const pending=commanderThreats(next,enemy,originalRules).map(m=>{const slot=+m.action.split('-')[1];return {against:enemy,index:m.from,slot,unit:ctlUnits(next[m.from])[slot]};});
  game.commander={scores:{r:game.commander?.scores?.r||0,b:game.commander?.scores?.b||0},pending};
  game.commander.scores[side]+=points;game.commander.scores[enemy]+=enemyPoints;
  game.board=next;game.turn=enemy;game.noCapture=captures.length||destroyed.length?0:(game.noCapture||0)+1;
  game.check=pending.length>0;game.checkSquare=game.check?commanderAt(next,enemy):null;
  const alive=commanderAt(next,side)>=0,enemyAlive=commanderAt(next,enemy)>=0;
  let result=!alive||!enemyAlive?{winner:alive?side:enemyAlive?enemy:null,reason:'commander-captured',line:captures}:null;
  if(originalRules&&result?.winner)game.commander.scores[result.winner]+=100;
  if(!originalRules&&!result&&game.noCapture>=120)result={winner:null,reason:'no-capture',line:[]};
  if(!originalRules&&!result&&!commanderLegal(game).length)result={winner:side,reason:'no-moves',line:[]};
  const verbs={move:'→',board:'lên',bomb:'ném bom',fire:'bắn'};
  return {result,captures,destroyed,effects,label:orders.map(o=>{
    const unit=units[o.unit];
    const symbol=originalRules?notation[type(unit)]+(hero(unit)?'*':''):unit;
    return `${symbol} ${ctlCoordinate(from)} ${verbs[o.mode]} ${ctlCoordinate(o.to)}`;
  }).join(' · ')};
}
export function chooseCommander(game){
  const moves=commanderLegal(game);if(!moves.length)return null;
  const side=game.turn,start=performance.now(),budget={easy:35,medium:100,hard:220}[game.difficulty]||100;
  const scored=moves.map(move=>{
    const victim=ctlUnits(game.board[move.to]),unit=ctlUnits(game.board[move.from])[+move.action.split('-')[1]];
    const capture=victim[0]?.[0]!==side?victim.reduce((n,u)=>n+(CTL_VALUES[type(u)]||0),0):0;
    const progress=side==='r'?row(move.from)-row(move.to):row(move.to)-row(move.from);
    return {move,score:capture*10+progress+(move.action.endsWith('-board')?2:0)-(type(unit)==='K'?3:0)};
  }).sort((a,b)=>b.score-a.score);
  let best=scored[0].move,bestScore=-Infinity;
  for(const {move,score}of scored.slice(0,game.difficulty==='easy'?12:40)){
    if(performance.now()-start>budget&&bestScore>-Infinity)break;
    const copy={...game,board:[...game.board],commander:structuredClone(game.commander)};
    const out=commanderMove(copy,move);if(!out)continue;
    let value=score;
    if(out.result)value=out.result.winner===side?1e7:out.result.winner?-1e7:0;
    else{
      const replies=rawMoves(copy.board,copy.turn,game.rules===COMMANDER_RULE);
      let danger=0;for(const reply of replies){const targets=ctlUnits(copy.board[reply.to]);if(targets[0]?.[0]===side)danger=Math.max(danger,targets.reduce((n,u)=>n+(CTL_VALUES[type(u)]||0),0));}
      value-=danger*(game.difficulty==='easy'?1:8);
      if(out.destroyed.length)value-=out.destroyed.reduce((n,u)=>n+CTL_VALUES[type(u)],0)*12;
    }
    if(value>bestScore){bestScore=value;best=move;}
  }
  return best;
}
