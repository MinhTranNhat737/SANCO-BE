// Five deterministic two-player games. Rules and selected variants: see NEW-GAMES.md.
export const ABSTRACT_KINDS=['coganh','ataxx','breakthrough','loa','isolation'];
export const abstractSize=kind=>kind==='coganh'?5:kind==='ataxx'?7:8;
const opponent=side=>side==='B'?'W':'B';
const directions=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const inside=(r,c,n)=>r>=0&&r<n&&c>=0&&c<n;
const at=(r,c,n)=>inside(r,c,n)?r*n+c:-1;
export function abstractInitial(kind){
  const n=abstractSize(kind),board=Array(n*n).fill(null);
  if(kind==='ataxx'){board[0]=board[48]='B';board[6]=board[42]='W';}
  if(kind==='breakthrough')for(let i=0;i<16;i++){board[i]='B';board[63-i]='W';}
  if(kind==='loa')for(let i=1;i<7;i++){board[i]=board[56+i]='B';board[i*8]=board[i*8+7]='W';}
  if(kind==='isolation'){board[0]='B';board[63]='W';}
  if(kind==='coganh'){
    for(const i of[20,21,22,23,24,15,19,14])board[i]='B';
    for(const i of[0,1,2,3,4,5,9,10])board[i]='W';
  }
  return board;
}
export function ganhNeighbors(index){
  const r=Math.floor(index/5),c=index%5;
  return directions.filter(([dr,dc])=>dr===0||dc===0||(r+c)%2===0).map(([dr,dc])=>at(r+dr,c+dc,5)).filter(i=>i>=0);
}
function ganhPairs(board,index,side){
  const r=Math.floor(index/5),c=index%5,enemy=opponent(side),out=[];
  for(const [dr,dc]of [[0,1],[1,0],...((r+c)%2===0?[[1,1],[1,-1]]:[])]){
    const a=at(r+dr,c+dc,5),b=at(r-dr,c-dc,5);
    if(a>=0&&b>=0&&board[a]===enemy&&board[b]===enemy)out.push(a,b);
  }
  return out;
}
function rawLegal(game,side=game.turn){
  const {kind,board}=game,n=abstractSize(kind),out=[];
  for(let from=0;from<board.length;from++)if(board[from]===side){
    const r=Math.floor(from/n),c=from%n;
    if(kind==='coganh'){
      for(const to of ganhNeighbors(from))if(!board[to])out.push({from,to});
    }else if(kind==='ataxx'){
      for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){
        const to=at(r+dr,c+dc,n);if(to>=0&&(dr||dc)&&!board[to])out.push({from,to});
      }
    }else if(kind==='breakthrough'){
      const dr=side==='W'?-1:1;
      for(const dc of[-1,0,1]){const to=at(r+dr,c+dc,n);if(to>=0&&(!board[to]||dc!==0&&board[to]===opponent(side)))out.push({from,to});}
    }else if(kind==='isolation'){
      for(const [dr,dc]of directions)for(let step=1;step<n;step++){
        const to=at(r+dr*step,c+dc*step,n);if(to<0||board[to])break;out.push({from,to});
      }
    }else if(kind==='loa'){
      for(const [dr,dc]of directions){
        let count=1;
        for(const sign of[-1,1])for(let step=1;step<n;step++){const i=at(r+dr*step*sign,c+dc*step*sign,n);if(i<0)break;if(board[i])count++;}
        const to=at(r+dr*count,c+dc*count,n);if(to<0||board[to]===side)continue;
        let blocked=false;for(let step=1;step<count;step++)if(board[at(r+dr*step,c+dc*step,n)]===opponent(side)){blocked=true;break;}
        if(!blocked)out.push({from,to});
      }
    }
  }
  return out;
}
export function abstractLegal(game){
  const moves=rawLegal(game);
  return game.kind==='coganh'&&game.forcedTo!=null?moves.filter(m=>m.to===game.forcedTo):moves;
}
export function connectedGroups(board,side,n=8){
  const unseen=new Set(board.flatMap((v,i)=>v===side?[i]:[]));let count=0;
  while(unseen.size){count++;const start=unseen.values().next().value,queue=[start];unseen.delete(start);
    for(const i of queue){const r=Math.floor(i/n),c=i%n;for(const [dr,dc]of directions){const next=at(r+dr,c+dc,n);if(unseen.delete(next))queue.push(next);}}
  }
  return count;
}
export function abstractMove(game,move){
  if(!abstractLegal(game).some(m=>m.from===move.from&&m.to===move.to))return null;
  const {kind,turn:side,board}=game,{from,to}=move,enemy=opponent(side),n=abstractSize(kind),captured=board[to]?to:null,flips=[];
  const distance=Math.max(Math.abs(Math.floor(from/n)-Math.floor(to/n)),Math.abs(from%n-to%n));
  board[to]=side;
  if(kind==='isolation')board[from]='#';
  else if(kind!=='ataxx'||distance===2)board[from]=null;
  if(kind==='ataxx')for(const [dr,dc]of directions){const i=at(Math.floor(to/n)+dr,to%n+dc,n);if(i>=0&&board[i]===enemy){board[i]=side;flips.push(i);}}
  if(kind==='coganh'){
    for(const i of ganhPairs(board,to,side)){board[i]=side;flips.push(i);}
    // Convert surrounded groups simultaneously, using the same pre-conversion position.
    const visited=new Set(),surrounded=[];
    for(let i=0;i<25;i++)if(board[i]===enemy&&!visited.has(i)){
      const queue=[i];visited.add(i);let liberty=false;
      for(const p of queue)for(const next of ganhNeighbors(p)){if(!board[next])liberty=true;else if(board[next]===enemy&&!visited.has(next)){visited.add(next);queue.push(next);}}
      if(!liberty)surrounded.push(...queue);
    }
    for(const i of surrounded){board[i]=side;flips.push(i);}
    game.forcedTo=null;
    if(!flips.length&&rawLegal(game,enemy).some(m=>m.to===from)&&ganhPairs(board,from,enemy).length)game.forcedTo=from;
  }
  game.turn=enemy;game.passed=null;
  const result=(winner,reason)=>({winner,reason,line:[]});let ending;
  if(kind==='breakthrough'&&(side==='W'?to<8:to>=56))ending=result(side,'breakthrough');
  if(kind==='loa'){
    // Simultaneous connection awards the win to the mover in this ruleset.
    if(connectedGroups(board,side)===1)ending=result(side,'connected');
    else if(connectedGroups(board,enemy)===1)ending=result(enemy,'connected');
  }
  if(!ending&&!board.includes(enemy))ending=result(side,'all-captured');
  if(!ending&&!abstractLegal(game).length){
    if(kind==='ataxx'||kind==='loa'){
      if(rawLegal(game,side).length){game.turn=side;game.passed=enemy;}
      else {const b=board.filter(v=>v==='B').length,w=board.filter(v=>v==='W').length;ending=result(kind==='loa'?null:b===w?null:b>w?'B':'W',kind==='loa'?'no-moves':'disc-count');}
    }else ending=result(side,'no-moves');
  }
  game.quiet=kind==='ataxx'?(distance===1||flips.length?0:(game.quiet||0)+1):0;
  if(!ending&&kind==='ataxx'&&game.quiet>=100)ending=result(null,'no-progress');
  const square=i=>`${'ABCDEFGH'[i%n]}${n-Math.floor(i/n)}`;
  return {label:`${square(from)}${captured!==null?' × ':' → '}${square(to)}${flips.length?` · đổi ${flips.length}`:''}`,captured,flips,...(ending?{result:ending}:{})};
}
function evaluate(game,root){
  if(game.result)return game.result.winner===root?100000:game.result.winner? -100000:0;
  const enemy=opponent(root),n=abstractSize(game.kind),mine=game.board.flatMap((v,i)=>v===root?[i]:[]),theirs=game.board.flatMap((v,i)=>v===enemy?[i]:[]);
  const mobility=rawLegal(game,root).length-rawLegal(game,enemy).length;
  if(game.kind==='isolation')return mobility*12;
  if(game.kind==='loa'){
    const compact=indices=>{const r=indices.reduce((s,i)=>s+Math.floor(i/n),0)/indices.length,c=indices.reduce((s,i)=>s+i%n,0)/indices.length;return indices.reduce((s,i)=>s+Math.abs(Math.floor(i/n)-r)+Math.abs(i%n-c),0);};
    return (connectedGroups(game.board,enemy)-connectedGroups(game.board,root))*100+compact(theirs)*3-compact(mine)*3+mobility;
  }
  if(game.kind==='breakthrough'){
    const progress=(indices,side)=>indices.reduce((s,i)=>{const v=side==='W'?7-Math.floor(i/8):Math.floor(i/8);return s+v*v*3;},0);
    return (mine.length-theirs.length)*35+progress(mine,root)-progress(theirs,enemy)+mobility;
  }
  return (mine.length-theirs.length)*35+mobility;
}
export function chooseAbstract(game){
  const moves=abstractLegal(game);if(!moves.length)return null;
  const root=game.turn,deadline=performance.now()+({easy:35,medium:100,hard:240}[game.difficulty]||100);
  const simulate=(g,m)=>{const next={...g,board:[...g.board]};const out=abstractMove(next,m);if(out?.result)next.result=out.result;return next;};
  const ranked=(g)=>abstractLegal(g).map(move=>{const next=simulate(g,move);return {move,next,score:evaluate(next,root)};}).sort((a,b)=>g.turn===root?b.score-a.score:a.score-b.score);
  let best=moves[0];
  const search=(g,depth,alpha,beta)=>{
    if(performance.now()>deadline)throw 'deadline';
    if(depth<=0||g.result)return evaluate(g,root);
    let value=g.turn===root?-Infinity:Infinity;
    for(const item of ranked(g).slice(0,18)){
      const score=search(item.next,depth-1,alpha,beta);
      if(g.turn===root){value=Math.max(value,score);alpha=Math.max(alpha,value);}else{value=Math.min(value,score);beta=Math.min(beta,value);}
      if(alpha>=beta)break;
    }
    return Number.isFinite(value)?value:evaluate(g,root);
  };
  const options=ranked(game);best=options[0].move;
  for(let depth=1;depth<=({easy:1,medium:2,hard:3}[game.difficulty]||2);depth++){
    let candidate=best,score=-Infinity;
    try{for(const item of options){const value=search(item.next,depth-1,-Infinity,Infinity);if(value>score){score=value;candidate=item.move;}}best=candidate;}catch(error){if(error!=='deadline')throw error;break;}
  }
  return best;
}
