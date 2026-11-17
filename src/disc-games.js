// Reversi uses black-first Othello rules; Connect Four uses gravity on 7 x 6.
export const discKinds=['reversi','connect4'];
export const discOther=side=>side==='B'?'W':side==='W'?'B':side==='R'?'Y':'R';
export function initialDiscs(kind){
  const board=Array(kind==='reversi'?64:42).fill(null);
  if(kind==='reversi'){board[27]='W';board[28]='B';board[35]='B';board[36]='W';}
  return board;
}
export function reversiFlips(board,to,side){
  if(!Number.isInteger(to)||to<0||to>=64||board[to])return [];
  const flips=[],row=Math.floor(to/8),col=to%8;
  for(const dr of[-1,0,1])for(const dc of[-1,0,1]){
    if(!dr&&!dc)continue;
    let r=row+dr,c=col+dc;const run=[];
    while(r>=0&&r<8&&c>=0&&c<8&&board[r*8+c]===discOther(side)){run.push(r*8+c);r+=dr;c+=dc;}
    if(run.length&&r>=0&&r<8&&c>=0&&c<8&&board[r*8+c]===side)flips.push(...run);
  }
  return flips;
}
export function discLegal(kind,board,side){
  if(kind==='reversi')return board.flatMap((v,to)=>!v&&reversiFlips(board,to,side).length?[{from:null,to}]:[]);
  const moves=[];
  for(let col=0;col<7;col++)for(let row=5;row>=0;row--)if(!board[row*7+col]){moves.push({from:null,to:row*7+col});break;}
  return moves;
}
export function fourLine(board,to){
  const side=board[to],row=Math.floor(to/7),col=to%7;
  if(!side)return [];
  for(const [dr,dc]of[[0,1],[1,0],[1,1],[1,-1]]){
    const line=[to];
    for(const sign of[-1,1]){let r=row+dr*sign,c=col+dc*sign;while(r>=0&&r<6&&c>=0&&c<7&&board[r*7+c]===side){line.push(r*7+c);r+=dr*sign;c+=dc*sign;}}
    if(line.length>=4)return line;
  }
  return [];
}
export function playDisc(kind,board,to,side){
  const flips=kind==='reversi'?reversiFlips(board,to,side):[];
  board[to]=side;for(const index of flips)board[index]=side;
  const next=discOther(side);
  if(kind==='connect4'){
    const line=fourLine(board,to);
    return {turn:next,flips,passed:null,...(line.length?{result:{winner:side,reason:'four',line}}:!board.includes(null)?{result:{winner:null,reason:'full',line:[]}}:{})};
  }
  if(discLegal(kind,board,next).length)return {turn:next,flips,passed:null};
  if(discLegal(kind,board,side).length)return {turn:side,flips,passed:next};
  const black=board.filter(v=>v==='B').length,white=board.filter(v=>v==='W').length;
  return {turn:next,flips,passed:null,result:{winner:black===white?null:black>white?'B':'W',reason:'disc-count',line:[]}};
}
