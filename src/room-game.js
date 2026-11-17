import * as caro from './game.js';
import {KINDS,boardSide,oppositeSide,createPractice,legalMoves,makePracticeMove} from './practice-engine.js';
import {PARTY_KINDS,newParty,eliminateParty} from './party-games.js';
export const {GameError}=caro;
export const seats=room=>room.players||[room.owner,room.guest].filter(Boolean);
export function seatOf(room,actor){const me=seats(room).find(s=>s.id===actor);if(!me)throw new GameError('Bạn chưa có quyền vào phòng này. Hãy mở liên kết mời.',403);return me;}
export const other=(side,kind='caro')=>oppositeSide(kind,side);
export function newGame(duration,id,kind='caro',count=2){
  if(kind==='caro')return caro.newGame(duration,id);
  const g=createPractice(kind,boardSide(kind),'medium',id);
  if(PARTY_KINDS.includes(kind)){g.party=newParty(kind,count);g.initialParty=structuredClone(g.party);}
  return {...g,phase:'waiting',rules:kind==='monopoly'?'monopoly-room-vn-v2':`${kind}-room-v1`,remaining:Object.fromEntries((g.party?.sides||[boardSide(kind),boardSide(kind,false)]).map(side=>[side,duration])),turnStartedAt:null};
}
export function settleTimeout(room,now){
  if((room.kind||'caro')==='caro')return caro.settleTimeout(room,now);
  const g=room.game;
  if(g.phase!=='playing'||g.turnStartedAt===null||now<g.turnStartedAt+g.remaining[g.turn])return false;
  const deadline=g.turnStartedAt+g.remaining[g.turn];g.remaining[g.turn]=0;
  if(g.party){eliminateParty(g,g.turn,'timeout');g.turnStartedAt=g.phase==='playing'?now:null;}else caro.finish(g,other(g.turn,room.kind),'timeout',deadline);return true;
}
export function applyAction(room,actor,action,data,now,nextGameId){
  if((room.kind||'caro')==='caro')return caro.applyAction(room,actor,action,data,now,nextGameId);
  const me=seatOf(room,actor),g=room.game;
  if(action==='ready'){
    if(g.phase!=='waiting')throw new GameError('Ván đã bắt đầu.',409);
    me.ready=!me.ready;if(seats(room).length===(room.capacity||2)&&seats(room).every(s=>s.ready)){g.phase='playing';g.turnStartedAt=now;}return;
  }
  if(action==='rematch'){
    if(g.phase!=='finished')throw new GameError('Chờ ván hiện tại kết thúc.',409);
    me.rematch=!me.rematch;
    if(seats(room).length>1&&seats(room).every(s=>s.rematch)){
      for(const s of seats(room)){s.mark=g.party?g.party.sides[(g.party.sides.indexOf(s.mark)+1)%g.party.sides.length]:other(s.mark,room.kind);s.ready=false;s.rematch=false;}
      room.drawOffer=null;room.game=newGame(room.duration,nextGameId,room.kind,room.capacity);
    }return;
  }
  if(g.phase!=='playing')throw new GameError('Ván chưa bắt đầu hoặc đã kết thúc.',409);
  if(g.party&&!g.party.players.find(p=>p.side===me.mark)?.active)throw new GameError('Bạn đã dừng ván.',409);
  const consume=()=>{g.remaining[g.turn]=Math.max(0,g.remaining[g.turn]-(now-g.turnStartedAt));};
  if(action==='resign'){consume();if(g.party){eliminateParty(g,me.mark);g.turnStartedAt=g.phase==='playing'?now:null;}else caro.finish(g,other(me.mark,room.kind),'resign',now);return;}
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
  const previous=g.turn,started=g.turnStartedAt;
  makePracticeMove(g,data,now);
  g.remaining[previous]=Math.max(0,g.remaining[previous]-(now-started));
  g.turnStartedAt=g.phase==='playing'?now:null;
  if(room.drawOffer&&room.drawOffer!==actor)room.drawOffer=null;
}
export function publicRoom(room,actor,now,online,summary=false){
  const me=seatOf(room,actor),kind=room.kind||'caro',seat=s=>({name:s.name,mark:s.mark,ready:s.ready,rematch:s.rematch,online:online?.(s.id)||false});
  const view=room.players?{id:room.id,version:room.version,duration:room.duration,createdAt:room.createdAt,inviteExpiresAt:room.inviteExpiresAt,owner:seat(room.owner),guest:room.guest?seat(room.guest):null,players:room.players.map(seat),capacity:room.capacity,me:{role:room.owner.id===actor?'owner':'guest',mark:me.mark,ready:me.ready,rematch:me.rematch},drawOffer:null,serverNow:now}:caro.publicRoom(room,actor,now,online);
  if(summary)return {...view,kind,summary:true,game:room.game};
  if(kind==='caro')return {...view,kind};
  const {repetitions,seenPositions,humanSide,difficulty,...game}=room.game;
  return {...view,kind,game:{...game,legal:game.phase==='playing'&&game.turn===view.me.mark?legalMoves(room.game):[]}};
}
export {KINDS,boardSide};
