import {GameError} from './game.js';
import {KINDS} from './practice-engine.js';
import {PARTY_KINDS} from './party-games.js';
import {INITIAL_ELO,validKind} from './ratings.js';

const LEASE_MS=20_000;
export const BOT_OFFER_MS=15_000;
const preset=(minutes,increment,pool)=>({id:`${minutes}-${increment}`,minutes,increment,pool});
const boardPresets=[preset(3,0,'blitz'),preset(3,2,'blitz'),preset(5,0,'blitz'),preset(10,0,'rapid'),preset(15,10,'rapid'),preset(30,0,'classical')];
const partyPresets=[preset(5,0,'blitz'),preset(10,0,'rapid'),preset(15,0,'rapid'),preset(30,0,'classical'),preset(60,0,'classical')];
export const matchPresets=Object.fromEntries(KINDS.map(kind=>[kind,PARTY_KINDS.includes(kind)?partyPresets:boardPresets]));
export const eloWindow=waitMs=>Math.min(200,25+25*Math.floor(Math.max(0,waitMs)/3500));

const ticketSql=`SELECT q.*, room.state->'game'->>'phase' AS phase FROM rank_queue q
  LEFT JOIN rooms room ON room.id=q.room_id WHERE q.player_id=$1`;

function ticketView(ticket,now){
  if(ticket?.phase==='playing')return {status:'matched',roomId:ticket.room_id,kind:ticket.kind,preset:ticket.preset};
  if(!ticket||ticket.room_id||Number(ticket.expires_at)<=now)return {status:'idle'};
  const waitedMs=Math.max(0,now-Number(ticket.joined_at));
  return {status:'searching',kind:ticket.kind,preset:ticket.preset,waitedMs,eloWindow:eloWindow(waitedMs),botAvailable:waitedMs>=BOT_OFFER_MS};
}

export class Matchmaking {
  constructor(db,rooms,now=Date.now){this.db=db;this.rooms=rooms;this.now=now;}

  async status(actor){
    const {rows:[ticket]}=await this.db.query(ticketSql,[actor]);
    return ticketView(ticket,this.now());
  }

  async update(user,action,selection){
    if(!user.account_id)throw new GameError('Đăng nhập để tìm trận xếp hạng với người chơi.',403);
    if(!['search','poll','cancel'].includes(action))throw new GameError('Thao tác tìm trận không hợp lệ.');
    let selected;
    if(action==='search'){
      selected=matchPresets[validKind(selection.kind)].find(p=>p.id===selection.preset);
      if(!selected)throw new GameError('Thời gian không hợp lệ cho môn cờ này.');
    }
    const result=await this.db.transaction(async client=>{
      // Serialize ticket claims with room creation and cancellation. A ticket can
      // never seed two games even when clients poll and cancel simultaneously.
      await client.query('SELECT id FROM rank_queue_lock WHERE id=1 FOR UPDATE');
      const now=this.now();
      const {rows:[current]}=await client.query(ticketSql,[user.id]);
      if(current?.phase==='playing')return {view:ticketView(current,now)};
      if(action==='cancel'){
        await client.query('DELETE FROM rank_queue WHERE player_id=$1',[user.id]);
        return {view:{status:'idle'}};
      }
      const prior=ticketView(current,now);
      if(action==='poll'&&prior.status!=='searching')return {view:prior};
      const kind=selection?.kind??current.kind;
      const presetId=selected?.id??current.preset;
      const config=selected??matchPresets[kind].find(p=>p.id===presetId);
      const sameSearch=prior.status==='searching'&&prior.kind===kind&&prior.preset===presetId;
      const joinedAt=sameSearch?Number(current.joined_at):now;
      await client.query(`INSERT INTO rank_queue(player_id,kind,preset,joined_at,expires_at) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(player_id) DO UPDATE SET kind=$2,preset=$3,joined_at=$4,expires_at=$5,room_id=NULL`,
      [user.id,kind,presetId,joinedAt,now+LEASE_MS]);
      const {rows:[rating]}=await client.query('SELECT elo FROM player_ratings WHERE player_id=$1 AND kind=$2 AND pool=$3',[user.id,kind,config.pool]);
      const elo=rating?.elo??INITIAL_ELO;
      const range=eloWindow(now-joinedAt);
      const {rows:[opponent]}=await client.query(`SELECT p.id,p.display_name,COALESCE(r.elo,$6) AS elo FROM rank_queue q
        JOIN players p ON p.id=q.player_id
        LEFT JOIN player_ratings r ON r.player_id=p.id AND r.kind=$2 AND r.pool=$5
        WHERE q.player_id<>$1 AND q.kind=$2 AND q.preset=$3 AND q.expires_at>$4 AND q.room_id IS NULL
          AND abs(COALESCE(r.elo,$6)-$7)<=LEAST($8,200,25+25*(($4-q.joined_at)/3500))
        ORDER BY abs(COALESCE(r.elo,$6)-$7),q.joined_at,q.player_id LIMIT 1`,
      [user.id,kind,presetId,now,config.pool,INITIAL_ELO,elo,range]);
      if(!opponent)return {view:ticketView({kind,preset:presetId,joined_at:joinedAt,expires_at:now+LEASE_MS},now)};

      const room=await this.rooms.createMatched(client,user,opponent,kind,config,[elo,opponent.elo]);
      await client.query('UPDATE rank_queue SET room_id=$1 WHERE player_id IN ($2,$3)',[room.id,user.id,opponent.id]);
      return {room,view:{status:'matched',roomId:room.id,kind,preset:presetId}};
    });
    if(result.room)this.rooms.changed(result.room);
    return result.view;
  }
}
