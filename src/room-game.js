import * as caro from './game.js';
import {KINDS,boardSide,oppositeSide,createPractice,legalMoves,makePracticeMove} from './practice-engine.js';
import {PARTY_KINDS,newParty,eliminateParty} from './party-games.js';
import {timeoutVietnamTurn,startVietnam} from './vietnam-estate.js';
import {COMMANDER_RULE,COMMANDER_DURATION_MS} from './commander.js';
export const MONOPOLY_TURN_MS=30_000;
export const {GameError}=caro;
export const seats=room=>room.players||[room.owner,room.guest].filter(Boolean);
export function seatOf(room,actor){const me=seats(room).find(s=>s.id===actor);if(!me)throw new GameError('Bạn chưa có quyền vào phòng này. Hãy mở liên kết mời.',403);return me;}
export const other=(side,kind='caro')=>oppositeSide(kind,side);
export function newGame(duration,id,kind='caro',count=2,estateMode,seatSides){
  if(kind==='caro')return caro.newGame(duration,id);
  const g=createPractice(kind,boardSide(kind),'medium',id);
  if(PARTY_KINDS.includes(kind)){g.party=newParty(kind,count,false,estateMode,seatSides);g.turn=g.party.sides[0];g.initialParty=structuredClone(g.party);}
  return {...g,phase:'waiting',rules:kind==='commander'?COMMANDER_RULE:kind==='monopoly'?'monopoly-room-vn-v2':`${kind}-room-v1`,remaining:Object.fromEntries((g.party?.sides||[boardSide(kind),boardSide(kind,false)]).map(side=>[side,duration])),turnStartedAt:null,...(kind==='monopoly'?{turnLimitMs:MONOPOLY_TURN_MS,turnDeadline:null}:{})};
}
export function startRoomGame(game,now){
  if(game.party?.profile){startVietnam(game);game.initialParty=structuredClone(game.party);}
  game.phase='playing';game.turnStartedAt=now;
  if(game.rules===COMMANDER_RULE)game.matchDeadline=now+COMMANDER_DURATION_MS;
  if(game.turnLimitMs)game.turnDeadline=now+game.turnLimitMs;
}
function beginRoom(room,now){
  if(room.kind==='monopoly'){
    const participants=seats(room);
    Object.assign(room.game,newGame(room.duration,room.game.id,room.kind,participants.length,room.estateMode,participants.map(seat=>seat.mark)));
  }
  startRoomGame(room.game,now);
}
export function clockDeadline(game){
  if(game.phase!=='playing'||game.turnStartedAt===null)return null;
  const main=game.matchDeadline??game.turnStartedAt+game.remaining[game.turn];
  return game.turnDeadline!=null?Math.min(main,game.turnDeadline):main;
}
export function settleTimeout(room,now){
  if((room.kind||'caro')==='caro')return caro.settleTimeout(room,now);
  const g=room.game;
  const deadline=clockDeadline(g);
  if(deadline===null||now<deadline)return false;
  if(g.matchDeadline!=null){
    const {r,b}=g.commander.scores;
    caro.finish(g,r===b?null:r>b?'r':'b','commander-time-score',deadline);
    return true;
  }
  const totalDeadline=g.turnStartedAt+g.remaining[g.turn];
  if(g.turnDeadline!=null&&now>=g.turnDeadline&&now<totalDeadline){
    g.remaining[g.turn]=Math.max(0,g.remaining[g.turn]-(now-g.turnStartedAt));
    timeoutVietnamTurn(g);
    g.turnStartedAt=g.phase==='playing'?now:null;
    g.turnDeadline=g.phase==='playing'?now+g.turnLimitMs:null;
    return true;
  }
  g.remaining[g.turn]=0;
  if(g.party){eliminateParty(g,g.turn,'timeout');g.turnStartedAt=g.phase==='playing'?now:null;if(g.turnLimitMs)g.turnDeadline=g.phase==='playing'?now+g.turnLimitMs:null;}else caro.finish(g,other(g.turn,room.kind),'timeout',deadline);return true;
}
export function applyAction(room,actor,action,data,now,nextGameId){
  if((room.kind||'caro')==='caro')return caro.applyAction(room,actor,action,data,now,nextGameId);
  const me=seatOf(room,actor),g=room.game;
  if(action==='ready'){
    if(g.phase!=='waiting')throw new GameError('Ván đã bắt đầu.',409);
    me.ready=!me.ready;if(seats(room).length===(room.capacity||2)&&seats(room).every(s=>s.ready))beginRoom(room,now);return;
  }
  if(action==='start'){
    if(room.kind!=='monopoly'||room.owner.id!==actor)throw new GameError('Chỉ chủ phòng Tỷ phú được bắt đầu sớm.',403);
    if(g.phase!=='waiting'||seats(room).length<2||!seats(room).every(seat=>seat.ready))throw new GameError('Cần ít nhất 2 người và tất cả đã sẵn sàng.',409);
    beginRoom(room,now);return;
  }
  if(action==='rematch'){
    if(g.phase!=='finished')throw new GameError('Chờ ván hiện tại kết thúc.',409);
    me.rematch=!me.rematch;
    if(seats(room).length>1&&seats(room).every(s=>s.rematch)){
      for(const s of seats(room)){s.mark=g.party?g.party.sides[(g.party.sides.indexOf(s.mark)+1)%g.party.sides.length]:other(s.mark,room.kind);s.ready=false;s.rematch=false;}
      if(room.kind==='commander')room.duration=COMMANDER_DURATION_MS;
      room.drawOffer=null;room.game=newGame(room.duration,nextGameId,room.kind,room.kind==='monopoly'?seats(room).length:room.capacity,room.estateMode,room.kind==='monopoly'?seats(room).map(seat=>seat.mark):undefined);
    }return;
  }
  if(g.phase!=='playing')throw new GameError('Ván chưa bắt đầu hoặc đã kết thúc.',409);
  if(g.party&&!g.party.players.find(p=>p.side===me.mark)?.active)throw new GameError('Bạn đã dừng ván.',409);
  const consume=()=>{if(g.matchDeadline==null)g.remaining[g.turn]=Math.max(0,g.remaining[g.turn]-(now-g.turnStartedAt));};
  if(action==='resign'){consume();if(g.party){eliminateParty(g,me.mark);g.turnStartedAt=g.phase==='playing'?now:null;if(g.turnLimitMs)g.turnDeadline=g.phase==='playing'?now+g.turnLimitMs:null;}else caro.finish(g,other(me.mark,room.kind),'resign',now);return;}
  if(g.party&&['draw','decline'].includes(action))throw new GameError('Ván nhiều người không hỗ trợ xin hòa.');
  if(action==='draw'){
    if(room.drawOffer===actor)throw new GameError('Bạn đã gửi lời mời hòa.');
    if(room.drawOffer){consume();caro.finish(g,null,'agreement',now);}else room.drawOffer=actor;return;
  }
  if(action==='decline'){
    if(!room.drawOffer||room.drawOffer===actor)throw new GameError('Không có lời mời hòa để từ chối.');
    room.drawOffer=null;return;
  }
  if(action!=='move')throw new GameError('Thao tác không được hỗ trợ.');
  if(g.turn!==me.mark)throw new GameError('Chưa đến lượt bạn.',409);
  const previous=g.turn,previousStage=g.party?.stage,started=g.turnStartedAt;
  makePracticeMove(g,data,now);
  if(g.matchDeadline==null)g.remaining[previous]=Math.max(0,g.remaining[previous]-(now-started));
  g.turnStartedAt=g.phase==='playing'?now:null;
  if(g.turnLimitMs){
    if(g.phase!=='playing')g.turnDeadline=null;
    else if(g.turn!==previous||(previousStage!=='roll'&&g.party?.stage==='roll'))g.turnDeadline=now+g.turnLimitMs;
  }
  if(room.drawOffer&&room.drawOffer!==actor)room.drawOffer=null;
}
export function publicRoom(room,actor,now,online,summary=false){
  const me=seatOf(room,actor),kind=room.kind||'caro',seat=s=>({name:s.name,mark:s.mark,ready:s.ready,rematch:s.rematch,online:online?.(s.id)||false});
  const view=room.players?{id:room.id,version:room.version,duration:room.duration,createdAt:room.createdAt,inviteExpiresAt:room.inviteExpiresAt,owner:seat(room.owner),guest:room.guest?seat(room.guest):null,players:room.players.map(seat),capacity:room.capacity,me:{role:room.owner.id===actor?'owner':'guest',mark:me.mark,ready:me.ready,rematch:me.rematch},drawOffer:null,serverNow:now}:caro.publicRoom(room,actor,now,online);
  view.ranked=!!room.ranked;
  if(room.matchmaking){
    view.matchmaking=room.matchmaking;
    view.owner.elo=room.owner.elo;
    view.guest.elo=room.guest.elo;
    if(view.players)for(const player of view.players)player.elo=room.players.find(seat=>seat.mark===player.mark).elo;
  }
  if(summary)return {...view,kind,summary:true,game:room.game};
  if(kind==='caro')return {...view,kind,game:{...view.game,ratingChanges:room.game.ratingChanges}};
  const {repetitions,seenPositions,humanSide,difficulty,...game}=room.game;
  return {...view,kind,...(room.estateMode?{estateMode:room.estateMode}:{}),game:{...game,legal:game.phase==='playing'&&game.turn===view.me.mark?legalMoves(room.game):[]}};
}
export {KINDS,boardSide};
