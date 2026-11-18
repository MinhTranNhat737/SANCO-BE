import {randomInt} from 'node:crypto';
import {KINDS} from './practice-engine.js';
import {GameError} from './game.js';

export const INITIAL_ELO=1000;
export const PLACEMENT_GAMES=10;
export const RANKS=[
  {name:'Đồng',min:0},{name:'Bạc',min:800},{name:'Vàng',min:1100},
  {name:'Bạch kim',min:1400},{name:'Kim cương',min:1700},
  {name:'Cao thủ',min:2000},{name:'Đại cao thủ',min:2300}
];
export function ratingView(row={}){
  const elo=Number(row.elo??INITIAL_ELO),games=Number(row.games||0);
  const index=RANKS.findLastIndex(rank=>elo>=rank.min),rank=RANKS[index],next=RANKS[index+1];
  return {elo,games,wins:Number(row.wins||0),draws:Number(row.draws||0),losses:Number(row.losses||0),peak:Number(row.peak??elo),
    provisional:games<PLACEMENT_GAMES,placementLeft:Math.max(0,PLACEMENT_GAMES-games),rank:games<PLACEMENT_GAMES?'Chưa xếp hạng':rank.name,
    tier:rank.name,nextRank:next?.name||null,nextElo:next?.min||null};
}
export const expectedScore=(elo,opponent)=>1/(1+10**((opponent-elo)/400));
export function eloDelta(elo,opponent,score,games=10){return Math.round((games<PLACEMENT_GAMES?40:24)*(score-expectedScore(elo,opponent)));}
export function validKind(kind){if(!KINDS.includes(kind))throw new GameError('Môn cờ không hợp lệ.');return kind;}

// Each game owns a roster; these are computer opponents, never fabricated users.
const BOT_NAMES=['Mầm Non','Tre Nhỏ','Trúc Xanh','Thông Reo','Bách Diệp','Tùng Sơn','Hải Âu','Chim Ưng','Bạch Hổ','Thanh Long','Kỳ Lân','Phượng Hoàng'];
export function botRoster(kind){validKind(kind);return BOT_NAMES.map((name,index)=>{
  const elo=400+index*150;
  return {id:`${kind}-bot-${elo}`,name,elo,rank:ratingView({elo,games:10}).rank,difficulty:elo<850?'easy':elo<1450?'medium':'hard',estimated:true};
});}
export function selectBot(kind,elo,id){
  const roster=botRoster(kind);
  if(id){const bot=roster.find(item=>item.id===id);if(!bot)throw new GameError('Bot không hợp lệ cho môn cờ này.');return bot;}
  const nearest=[...roster].sort((a,b)=>Math.abs(a.elo-elo)-Math.abs(b.elo-elo));
  return nearest[0];
}
export async function playerRatings(db,playerId){
  const {rows}=await db.query('SELECT * FROM player_ratings WHERE player_id=$1',[playerId]);
  return Object.fromEntries(KINDS.map(kind=>[kind,ratingView(rows.find(row=>row.kind===kind))]));
}
export async function leaderboard(db,kind){
  validKind(kind);
  const {rows}=await db.query(`SELECT r.*,p.display_name FROM player_ratings r JOIN players p ON p.id=r.player_id
    WHERE r.kind=$1 AND r.games >= $2 ORDER BY r.elo DESC,r.games DESC,r.player_id LIMIT 50`,[kind,PLACEMENT_GAMES]);
  return rows.map((row,index)=>({position:index+1,name:row.display_name,...ratingView(row)}));
}

// Called inside the same transaction that finishes the game. Sorted row locks
// serialize concurrent matches, and the settlement key makes retries harmless.
export async function settleRating(client,{id,kind,source,participants,winner}){
  validKind(kind);
  const claim=await client.query('INSERT INTO rating_settlements(game_id,kind,source,changes,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING game_id',[id,kind,source,'{}',Date.now()]);
  if(!claim.rows.length){const {rows}=await client.query('SELECT changes FROM rating_settlements WHERE game_id=$1',[id]);return rows[0].changes;}
  const people=participants.filter(p=>p.id).sort((a,b)=>a.id.localeCompare(b.id));
  const ratings=new Map();
  for(const person of people){
    await client.query('INSERT INTO player_ratings(player_id,kind,updated_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[person.id,kind,Date.now()]);
    const {rows}=await client.query('SELECT * FROM player_ratings WHERE player_id=$1 AND kind=$2 FOR UPDATE',[person.id,kind]);
    ratings.set(person.id,rows[0]);
  }
  const changes={};
  for(const person of people){
    const current=ratings.get(person.id),opponents=participants.filter(p=>p!==person);
    const score=winner===null ? .5 : winner===person.mark ? 1 : 0;
    // In multiplayer, non-winners tie with one another and lose to the winner.
    const difference=opponents.reduce((sum,opponent)=>{
      const pairScore=winner===null ? .5 : winner===person.mark ? 1 : winner===opponent.mark ? 0 : .5;
      const opponentElo=opponent.id?ratings.get(opponent.id).elo:opponent.elo;
      return sum+pairScore-expectedScore(current.elo,opponentElo);
    },0)/opponents.length;
    const after=Math.max(100,current.elo+Math.round((current.games<PLACEMENT_GAMES?40:24)*difference));
    const {rows}=await client.query(`UPDATE player_ratings SET elo=$1,games=games+1,wins=wins+$2,draws=draws+$3,losses=losses+$4,peak=GREATEST(peak,$1),updated_at=$5
      WHERE player_id=$6 AND kind=$7 RETURNING *`,[after,score===1?1:0,score===.5?1:0,score===0?1:0,Date.now(),person.id,kind]);
    changes[person.mark]={before:current.elo,after,delta:after-current.elo,...ratingView(rows[0])};
  }
  await client.query('UPDATE rating_settlements SET changes=$1 WHERE game_id=$2',[JSON.stringify(changes),id]);
  return changes;
}
