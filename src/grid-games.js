// Small board engines: Go (9x9, positional superko, Chinese area), English draughts, tic-tac-toe.
export const GRID_KINDS=['go','checkers','tictactoe'];
const enemy=side=>side==='B'?'W':side==='W'?'B':side==='X'?'O':'X';
export const gridSize=kind=>kind==='go'?9:kind==='checkers'?8:3;
export function initialGrid(kind){
  const board=Array(gridSize(kind)**2).fill(null);
  if(kind==='checkers')for(let r=0;r<8;r++)for(let c=0;c<8;c++)if((r+c)%2&& (r<3||r>4))board[r*8+c]=(r<3?'W':'B')+'M';
  return board;
}
function neighbors(i,n){const r=Math.floor(i/n),c=i%n;return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].filter(([r,c])=>r>=0&&r<n&&c>=0&&c<n).map(([r,c])=>r*n+c);}
function group(board,index,n){
  const stones=new Set([index]),liberties=new Set(),queue=[index],side=board[index];
  for(const at of queue)for(const next of neighbors(at,n)){if(!board[next])liberties.add(next);else if(board[next]===side&&!stones.has(next)){stones.add(next);queue.push(next);}}
  return {stones:[...stones],liberties};
}
export function goPlay(board,to,side,seen={}){
  if(!Number.isInteger(to)||to<0||to>=81||board[to])return null;
  const next=[...board],captured=[];next[to]=side;
  for(const at of neighbors(to,9))if(next[at]===enemy(side)){
    const chain=group(next,at,9);if(!chain.liberties.size)for(const index of chain.stones){next[index]=null;captured.push(index);}
  }
  if(!group(next,to,9).liberties.size)return null;
  const key=next.map(v=>v||'.').join('');if(seen[key])return null;
  return {board:next,captured,key};
}
export function goScore(board,komi=6.5){
  let black=board.filter(v=>v==='B').length,white=board.filter(v=>v==='W').length;const seen=new Set();
  for(let i=0;i<81;i++)if(!board[i]&&!seen.has(i)){
    const region=[i],border=new Set();seen.add(i);
    for(const at of region)for(const next of neighbors(at,9)){if(board[next])border.add(board[next]);else if(!seen.has(next)){seen.add(next);region.push(next);}}
    if(border.size===1){if(border.has('B'))black+=region.length;else white+=region.length;}
  }
  return {B:black,W:white+komi,komi};
}
export function checkersMoves(game){
  const {board,turn,forcedFrom}=game,captures=[],steps=[];
  for(let from=0;from<64;from++){
    const piece=board[from];if(!piece||piece[0]!==turn||forcedFrom!=null&&from!==forcedFrom)continue;
    const r=Math.floor(from/8),c=from%8,dirs=piece[1]==='K'?[-1,1]:turn==='B'?[-1]:[1];
    for(const dr of dirs)for(const dc of[-1,1]){
      const r1=r+dr,c1=c+dc;if(r1<0||r1>=8||c1<0||c1>=8)continue;
      const near=r1*8+c1;if(!board[near]&&forcedFrom==null)steps.push({from,to:near});
      const r2=r+dr*2,c2=c+dc*2;if(board[near]&&board[near][0]!==turn&&r2>=0&&r2<8&&c2>=0&&c2<8&&!board[r2*8+c2])captures.push({from,to:r2*8+c2});
    }
  }
  return captures.length?captures:forcedFrom!=null?[]:steps;
}
export function gridLegal(game){
  if(game.kind==='checkers')return checkersMoves(game);
  if(game.kind==='tictactoe')return game.board.flatMap((v,to)=>v?[]:[{from:null,to}]);
  return [...game.board.flatMap((v,to)=>!v&&goPlay(game.board,to,game.turn,game.seenPositions)?[{from:null,to}]:[]),{from:null,to:-1,pass:true}];
}
export function ticLine(board){for(const line of[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]])if(board[line[0]]&&line.every(i=>board[i]===board[line[0]]))return line;return [];}
export function gridMove(game,request){
  const {kind,turn:side}=game,{from=null,to}=request;
  if(kind==='go'){
    if(to===-1&&request.pass){game.passes=(game.passes||0)+1;game.turn=enemy(side);if(game.passes===2){game.score=goScore(game.board);return {label:'Bỏ lượt',result:{winner:game.score.B>game.score.W?'B':'W',reason:'area',line:[]}};}return {label:'Bỏ lượt'};}
    const out=goPlay(game.board,to,side,game.seenPositions);if(!out)return null;
    game.board=out.board;game.seenPositions[out.key]=true;game.passes=0;game.turn=enemy(side);game.prisoners[side]+=out.captured.length;
    return {label:`${'ABCDEFGHJ'[to%9]}${9-Math.floor(to/9)}`,captures:out.captured};
  }
  if(kind==='tictactoe'){
    game.board[to]=side;game.turn=enemy(side);const line=ticLine(game.board);
    return {label:`${'ABC'[to%3]}${3-Math.floor(to/3)}`,...(line.length?{result:{winner:side,reason:'three',line}}:!game.board.includes(null)?{result:{winner:null,reason:'full',line:[]}}:{})};
  }
  const piece=game.board[from],dr=Math.abs(Math.floor(to/8)-Math.floor(from/8)),captured=dr===2?[(from+to)/2]:[];
  game.board[to]=piece;game.board[from]=null;for(const at of captured)game.board[at]=null;
  const crowned=piece[1]==='M'&&(side==='B'?to<8:to>=56);if(crowned)game.board[to]=side+'K';
  game.forcedFrom=null;
  if(captured.length&&!crowned){game.forcedFrom=to;if(!checkersMoves(game).length)game.forcedFrom=null;}
  if(game.forcedFrom==null)game.turn=enemy(side);
  game.quiet=captured.length||crowned?0:(game.quiet||0)+1;
  return {label:`${from+1}${captured.length?' × ':' → '}${to+1}`,captures:captured,...(!checkersMoves(game).length?{result:{winner:side,reason:'no-moves',line:[]}}:game.quiet>=80?{result:{winner:null,reason:'no-progress',line:[]}}:{})};
}
