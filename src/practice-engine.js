import {ABSTRACT_KINDS,abstractInitial,abstractLegal,abstractMove} from './abstract-games.js';
import {initialCommander,commanderLegal,commanderMove} from './commander.js';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import { GameError, winningLine, coordinate } from './game.js';
import { initialXiangqi, xLegal, xInCheck, xOther } from './xiangqi.js';
import {discKinds,initialDiscs,discLegal,playDisc} from './disc-games.js';
import {GRID_KINDS,initialGrid,gridLegal,gridMove} from './grid-games.js';
import {PARTY_KINDS,newParty,partyLegal,partyMove,PARTY_SIDES} from './party-games.js';

export const KINDS = ['caro','chess','xiangqi','reversi','connect4','go','ludo','monopoly','checkers','tictactoe',...ABSTRACT_KINDS,'commander'];
export const boardSide = (kind, first=true) => kind==='caro'||kind==='tictactoe' ? first?'X':'O' : kind==='chess' ? first?'w':'b' : kind==='breakthrough'?first?'W':'B':ABSTRACT_KINDS.includes(kind)?first?'B':'W': ['reversi','go','checkers'].includes(kind)?first?'B':'W':PARTY_KINDS.includes(kind)?first?'R':'G':kind==='connect4'?first?'R':'Y':first?'r':'b';
export const oppositeSide = (kind,side) => side === boardSide(kind) ? boardSide(kind,false) : boardSide(kind);
export const squareIndex = square => (8-Number(square[1]))*8 + square.charCodeAt(0)-97;
export const chessSquare = index => `${'abcdefgh'[index%8]}${8-Math.floor(index/8)}`;
export const xCoordinate = index => `${'ABCDEFGHI'[index%9]}${10-Math.floor(index/9)}`;
export const chessBoard = chess => chess.board().flat().map(piece=>piece ? piece.color+piece.type.toUpperCase() : null);
export const positionKey = game => game.kind==='chess' ? game.fen.split(' ').slice(0,4).join(' ') : game.board.map(p=>p||'.').join(game.kind==='commander'?'/':'')+game.turn+(game.kind==='coganh'?`:${game.forcedTo??''}`:game.kind==='commander'?JSON.stringify(game.commander?.pending||[]):'');
export function createPractice(kind, humanSide, difficulty, id) {
  if (!KINDS.includes(kind)) throw new GameError('Môn cờ không hợp lệ.');
  if (!['easy','medium','hard'].includes(difficulty)) throw new GameError('Độ khó không hợp lệ.');
  if (![boardSide(kind),boardSide(kind,false)].includes(humanSide)) throw new GameError('Bên quân không hợp lệ.');
  const chess = kind==='chess' ? new Chess() : null;
  const game = { id, kind, difficulty, humanSide, version: 0, rules: `${kind}-practice-v1`, phase: 'playing', turn: boardSide(kind),
    board: kind==='commander'?initialCommander():ABSTRACT_KINDS.includes(kind)?abstractInitial(kind):kind==='caro'?Array(225).fill(null):kind==='chess'?chessBoard(chess):discKinds.includes(kind)?initialDiscs(kind):GRID_KINDS.includes(kind)?initialGrid(kind):PARTY_KINDS.includes(kind)?Array(kind==='ludo'?225:169).fill(null):initialXiangqi(),
    moves: [], result: null, check: false, checkSquare: null, createdAt: Date.now(), noCapture: 0, repetitions: {},
    ...(chess ? { fen: DEFAULT_POSITION } : {}) };
  game.initialBoard = [...game.board]; game.repetitions[positionKey(game)]=1;
  if(kind==='commander'){game.commander={scores:{r:0,b:0},pending:[]};game.rules='commander-total-v1';}
  if(kind==='go'){game.seenPositions={[game.board.map(v=>v||'.').join('')]:true};game.passes=0;game.prisoners={B:0,W:0};}
  if(PARTY_KINDS.includes(kind)){game.party=newParty(kind);game.initialParty=structuredClone(game.party);if(kind==='monopoly')game.rules='monopoly-vn-v2';}
  return game;
}
export function legalMoves(game) {
  if (game.phase !== 'playing') return [];
  if (game.kind==='commander') return commanderLegal(game);
  if (ABSTRACT_KINDS.includes(game.kind)) return abstractLegal(game);
  if (GRID_KINDS.includes(game.kind)) return gridLegal(game);
  if (PARTY_KINDS.includes(game.kind)) return partyLegal(game);
  if (discKinds.includes(game.kind)) return discLegal(game.kind,game.board,game.turn);
  if (game.kind==='caro') return game.board.flatMap((value,to)=>value?[]:[{from:null,to}]);
  if (game.kind==='xiangqi') return xLegal(game.board,game.turn);
  return new Chess(game.fen).moves({verbose:true}).map(move=>({from:squareIndex(move.from),to:squareIndex(move.to),...(move.promotion?{promotion:move.promotion}:{})}));
}
export function endPractice(game,winner,reason,at=Date.now(),line=[]) {
  game.phase='finished'; game.result={winner,reason,at,line};
}
export function makePracticeMove(game, request, now=Date.now()) {
  if (game.phase!=='playing') throw new GameError('Ván luyện tập đã kết thúc.',409);
  const {from=null,to,promotion}=request;
  if(game.kind==='commander'){
    const side=game.turn,piece=game.board[from],out=commanderMove(game,request);
    if(!out)throw new GameError('Lệnh không hợp lệ. Chọn quân và mục tiêu được đánh dấu.');
    if(out.result)endPractice(game,out.result.winner,out.result.reason,now,out.result.line);
    const key=positionKey(game);game.repetitions[key]=(game.repetitions[key]||0)+1;
    if(game.phase==='playing'&&game.repetitions[key]>=3)endPractice(game,null,'repetition',now);
    game.moves.push({from,to,side,piece,captured:null,action:request.action,details:request.details,label:out.label,at:now,board:[...game.board],check:game.check,checkSquare:game.checkSquare,captures:out.captures,effects:out.effects,commander:structuredClone(game.commander)});
    if(game.phase==='playing'&&game.moves.length>=1000)endPractice(game,null,'move-limit',now);
    return game;
  }
  if(ABSTRACT_KINDS.includes(game.kind)){
    if(promotion||request.pass||request.action&&request.action!=='move')throw new GameError('N??c ?i kh?ng h?p l?.');
    const side=game.turn,piece=game.board[from],out=abstractMove(game,request);
    if(!out)throw new GameError('N??c ?i kh?ng h?p l?. Ch?n ? ???c ??nh d?u.');
    const key=positionKey(game);game.repetitions[key]=(game.repetitions[key]||0)+1;
    if(out.result)endPractice(game,out.result.winner,out.result.reason,now,out.result.line);
    else if(game.repetitions[key]>=3)endPractice(game,null,'repetition',now);
    game.moves.push({from,to,side,piece,captured:out.captured!==null?oppositeSide(game.kind,side):null,label:out.label,at:now,board:[...game.board],check:false,checkSquare:null,flips:out.flips,passed:game.passed});
    if(game.moves.length>=1000&&game.phase==='playing')endPractice(game,null,'move-limit',now);
    return game;
  }
  if(GRID_KINDS.includes(game.kind)||PARTY_KINDS.includes(game.kind)){
    if(!legalMoves(game).some(m=>m.from===from&&m.to===to&&!!m.pass===!!request.pass&&(m.action||'move')===(request.action||'move')))throw new GameError('Nước đi không hợp lệ.');
    const side=game.turn,piece=game.kind==='checkers'?game.board[from]:side;
    const out=PARTY_KINDS.includes(game.kind)?partyMove(game,request):gridMove(game,request);
    if(!out)throw new GameError('Nước đi không hợp lệ.');
    if(out.result)endPractice(game,out.result.winner,out.result.reason,now,out.result.line);
    game.moves.push({from,to,side,piece,captured:null,label:out.label,at:now,board:[...game.board],check:false,checkSquare:null,...(request.pass?{pass:true}:{}),...(out.captures?{captures:out.captures}:{}),...(game.party?{action:request.action||'move',die:out.die,...(out.dice?{dice:out.dice}:{}),card:out.card,party:structuredClone(game.party.edition?{...game.party,ledger:[]}:game.party)}:{})});
    if(game.moves.length>=1500&&game.phase==='playing')endPractice(game,null,'move-limit',now);
    return game;
  }
  const placement=game.kind==='caro'||discKinds.includes(game.kind);
  const count=game.board.length;
  if (!Number.isInteger(to)||to<0||to>=count||(!placement&&(!Number.isInteger(from)||from<0||from>=count))) throw new GameError('Ô cờ không hợp lệ.');
  if(discKinds.includes(game.kind)){
    if(from!==null||promotion||!legalMoves(game).some(m=>m.to===to))throw new GameError('Nước đi không hợp lệ. Chọn một ô được đánh dấu.');
    const side=game.turn,out=playDisc(game.kind,game.board,to,side);
    game.turn=out.turn;game.passed=out.passed;
    if(out.result)endPractice(game,out.result.winner,out.result.reason,now,out.result.line);
    const cols=game.kind==='reversi'?8:7,rows=game.kind==='reversi'?8:6;
    const label=`${'ABCDEFGH'[to%cols]}${rows-Math.floor(to/cols)}${out.flips.length?` · lật ${out.flips.length}`:''}${out.passed?' · đối thủ bỏ lượt':''}`;
    game.moves.push({from:null,to,side,piece:side,captured:null,label,at:now,board:[...game.board],check:false,checkSquare:null,flips:out.flips,passed:out.passed});
    return game;
  }
  const side=game.turn, piece=game.kind==='caro'?side:game.board[from];let captured=game.board[to];
  let label;
  if (game.kind==='chess') {
    const chess=new Chess(game.fen); let move;
    try { move=chess.move({from:chessSquare(from),to:chessSquare(to),...(promotion?{promotion}:{})}); } catch { throw new GameError('Nước đi không hợp lệ. Chọn một ô được đánh dấu.'); }
    if(move.captured)captured=oppositeSide('chess',side)+move.captured.toUpperCase();
    game.fen=chess.fen();game.board=chessBoard(chess);game.turn=chess.turn();label=move.san;
    game.check=chess.isCheck();game.checkSquare=game.check?game.board.indexOf(game.turn+'K'):null;
    if(chess.isCheckmate())endPractice(game,side,'checkmate',now);
    else if(chess.isStalemate())endPractice(game,null,'stalemate',now);
    else if(chess.isInsufficientMaterial())endPractice(game,null,'material',now);
    else if(chess.isDrawByFiftyMoves())endPractice(game,null,'fifty',now);
  } else {
    if (!legalMoves(game).some(move=>move.from===from&&move.to===to)) throw new GameError('Nước đi không hợp lệ. Chọn một ô được đánh dấu.');
    if(game.kind==='caro') {
      game.board[to]=side; label=coordinate(to); const line=winningLine(game.board,to);
      if(line.length)endPractice(game,side,'five',now,line);
      else if(!game.board.includes(null))endPractice(game,null,'full',now);
    } else {
      game.board[to]=game.board[from];game.board[from]=null; label=`${xCoordinate(from)}${captured?' × ':' → '}${xCoordinate(to)}`;
      game.noCapture=captured?0:game.noCapture+1;
    }
    game.turn=oppositeSide(game.kind,side);
    if(game.kind==='xiangqi') {
      game.check=xInCheck(game.board,game.turn);game.checkSquare=game.check?game.board.indexOf(game.turn+'K'):null;
      if(!xLegal(game.board,game.turn).length)endPractice(game,side,game.check?'checkmate':'no-moves',now);
      else if(game.noCapture>=120)endPractice(game,null,'no-capture',now);
    }
  }
  const key=positionKey(game);game.repetitions[key]=(game.repetitions[key]||0)+1;
  if(game.phase==='playing'&&game.kind!=='caro'&&game.repetitions[key]>=3)endPractice(game,null,'repetition',now);
  game.moves.push({from,to,side,piece,captured,label,...(promotion?{promotion}:{}),at:now,board:[...game.board],check:game.check,checkSquare:game.checkSquare});
  if(game.phase==='playing'&&game.moves.length>=600)endPractice(game,null,'move-limit',now);
  return game;
}
export function undoHumanTurn(game) {
  if(PARTY_KINDS.includes(game.kind))throw new GameError('Ván xúc xắc không hỗ trợ đi lại.');
  const index=game.moves.findLastIndex(move=>move.side===game.humanSide);
  if(index<0)throw new GameError('Bạn chưa có nước đi nào để đi lại.');
  const restored=createPractice(game.kind,game.humanSide,game.difficulty,game.id);
  for(const move of game.moves.slice(0,index))makePracticeMove(restored,move,move.at);
  restored.createdAt=game.createdAt;restored.version=game.version;
  return restored;
}
export function practiceView(game) {
  const {repetitions:_repetitions,seenPositions:_seen,...view}=game;
  return {...view,thinking:game.phase==='playing'&&game.turn!==game.humanSide,legal:game.phase==='playing'&&game.turn===game.humanSide?legalMoves(game):[]};
}
