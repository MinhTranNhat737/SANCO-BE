import {randomUUID,randomInt} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {availableParallelism} from 'node:os';
import {GameError} from './game.js';
import {digest} from './auth.js';
import {playerRatings,selectBot,settleRating} from './ratings.js';
import {NativeBotService} from './native-engine.js';
import {createPractice,boardSide,legalMoves,makePracticeMove,practiceView,endPractice,oppositeSide,undoHumanTurn} from './practice-engine.js';

export const PRACTICE_INACTIVITY_MS = 5 * 60 * 1000;

export class PracticeService {
  constructor(db,onChange=()=>{},options={}){
    this.db=db;this.onChange=onChange;
    this.nativeBots=options.nativeBots||new NativeBotService(options.engines);
    this.engineWarnings=new Set();
    const workerCount=Number(options.botWorkers??process.env.BOT_WORKERS??Math.max(1,Math.min(4,availableParallelism()-1)));
    if(!Number.isInteger(workerCount)||workerCount<1||workerCount>16)throw new Error('BOT_WORKERS must be an integer from 1 to 16');
    this.botWorkers=workerCount;
    this.inactivityMs=Number.isFinite(options.inactivityMs)?options.inactivityMs:PRACTICE_INACTIVITY_MS;
    const envPartyDelay=process.env.PARTY_BOT_DELAY_MS!==undefined?Number(process.env.PARTY_BOT_DELAY_MS):NaN;
    this.partyBotDelayMs=Number.isFinite(options.partyBotDelayMs)?options.partyBotDelayMs:(Number.isFinite(envPartyDelay)?envPartyDelay:(process.env.NODE_ENV==='test'?0:2200));
    this.onDelete=options.onDelete||(()=>{});
    this.pending=new Set();this.queue=[];this.workers=new Set();this.attemptedVersions=new Map();this.delayTimers=new Map();this.running=0;this.sweepTimer=null;this.closed=false;
  }
  async start(){
    await this.pruneInactive();
    const {rows}=await this.db.query("SELECT id FROM practice_games WHERE state->>'phase'='playing' AND state->>'turn'<>state->>'humanSide'");
    for(const row of rows)this.schedule(row.id);
  }
  async cancelInactiveGame(id,cutoff){
    const deleted=await this.db.transaction(async client=>{
      const {rows}=await client.query('SELECT player_id,updated_at,state FROM practice_games WHERE id=$1 FOR UPDATE',[id]);
      if(!rows[0]||Number(rows[0].updated_at)>cutoff)return null;
      const game=rows[0].state;
      if(game.ranked&&game.phase==='playing'){
        endPractice(game,oppositeSide(game.kind,game.humanSide),'inactive');
        await this.persist(client,game,rows[0].player_id);
      }
      await client.query('DELETE FROM practice_games WHERE id=$1',[id]);
      return {id,playerId:rows[0].player_id,ranked:!!game.ranked};
    });
    if(deleted&&!this.closed)this.onDelete(id,deleted.playerId,deleted.ranked);
    return deleted;
  }
  async ensureActive(id){
    if(this.closed||this.inactivityMs<=0)return;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))return;
    const cutoff=Date.now()-this.inactivityMs;
    const deleted=await this.cancelInactiveGame(id,cutoff);
    if(deleted){
      await this.scheduleSweep();
      throw new GameError('Bàn đã bị hủy và xóa do không hoạt động quá 5 phút.',410);
    }
  }
  async pruneInactive(now=Date.now()){
    if(this.closed||this.inactivityMs<=0)return [];
    const cutoff=now-this.inactivityMs;
    const {rows}=await this.db.query('SELECT id FROM practice_games WHERE updated_at <= $1',[cutoff]);
    const removed=[];
    for(const row of rows){
      const out=await this.cancelInactiveGame(row.id,cutoff);
      if(out)removed.push(out.id);
    }
    await this.scheduleSweep();
    return removed;
  }
  async scheduleSweep(){
    clearTimeout(this.sweepTimer);this.sweepTimer=null;
    if(this.closed||this.inactivityMs<=0)return;
    try{
      const {rows}=await this.db.query('SELECT MIN(updated_at) AS oldest FROM practice_games');
      if(this.closed||!rows[0]?.oldest)return;
      const delay=Math.max(10,Number(rows[0].oldest)+this.inactivityMs-Date.now());
      this.sweepTimer=setTimeout(()=>{this.pruneInactive().catch(error=>console.error('Practice inactivity sweep failed:',error.message));},Math.min(delay,2147483647));
      this.sweepTimer.unref();
    }catch(error){
      if(!this.closed)console.error('Practice sweep schedule failed:',error.message);
    }
  }
  async read(id,actor,client=this.db,lock=false){
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))throw new GameError('Không tìm thấy ván luyện tập.',404);
    const {rows}=await client.query(`SELECT state,player_id FROM practice_games WHERE id=$1${actor?' AND player_id=$2':''}${lock?' FOR UPDATE':''}`,[id,...(actor?[actor]:[])]);
    if(!rows[0])throw new GameError('Không tìm thấy ván hoặc bạn không có quyền xem.',404);return rows[0];
  }
  async create(player,body){
    const {kind,difficulty='medium',side='first'}=body;
    if(body.ranked!==undefined&&typeof body.ranked!=='boolean')throw new GameError('Chế độ xếp hạng không hợp lệ.');
    if(!['first','second','random'].includes(side))throw new GameError('Bên quân không hợp lệ.');
    await this.pruneInactive();
    const game=await this.db.transaction(async client=>{
    await client.query('SELECT id FROM players WHERE id=$1 FOR UPDATE',[player.id]);
    if(body.ranked){
      const active=await client.query("SELECT state FROM practice_games WHERE player_id=$1 AND kind=$2 AND state->>'ranked'='true' AND state->>'phase'='playing' LIMIT 1",[player.id,kind]);
      if(active.rows.length)return active.rows[0].state;
    }
    const rating=body.ranked?(await playerRatings(client,player.id))[kind]:null;
    const bot=body.ranked?selectBot(kind,rating?.elo,body.botId):null;
    const humanSide=boardSide(kind,side==='random'||body.ranked?!!randomInt(2):side==='first');
    const game=createPractice(kind,humanSide,bot?.difficulty||difficulty,randomUUID());
    if(bot){game.ranked=true;game.bot=bot;game.playerElo=rating.elo;}
    const {rows}=await client.query("SELECT count(*)::int AS n FROM practice_games WHERE player_id=$1 AND created_at>$2",[player.id,Date.now()-3600000]);
    if(rows[0].n>=40)throw new GameError('Bạn đã tạo nhiều ván. Hãy tiếp tục một ván đang có.',429);
    await client.query('INSERT INTO practice_games(id,player_id,kind,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)',[game.id,player.id,kind,JSON.stringify(game),Date.now()]);
    return game;
    });
    this.changed(game,player.id);return practiceView(game);
  }
  async persist(client,game,actor){
    if(game.ranked&&game.phase==='finished'){
      const changes=await settleRating(client,{id:game.id,kind:game.kind,source:'bot',winner:game.result.winner,
        participants:[{id:actor,mark:game.humanSide},{mark:oppositeSide(game.kind,game.humanSide),elo:game.bot.elo}]});
      game.ratingChange=changes[game.humanSide];
    }
    game.version++;await client.query('UPDATE practice_games SET state=$1,version=$2,updated_at=$3 WHERE id=$4',[JSON.stringify(game),game.version,Date.now(),game.id]);
  }
  changed(game,actor){
    if(this.closed)return;
    void this.scheduleSweep();
    this.onChange(practiceView(game),actor);
    if(game.phase==='playing'&&game.turn!==game.humanSide){
      const isPartyGame=game.kind==='monopoly'||game.kind==='ludo';
      if(isPartyGame&&this.partyBotDelayMs>0){
        const last=game.moves.at(-1);
        let delay;
        if(last?.action==='roll'){
          const steps=Array.isArray(last.dice)&&last.dice.length?last.dice.reduce((a,b)=>a+b,0):(Number(last.die)||6);
          const stepMs=Math.round(this.partyBotDelayMs*0.065);
          delay=this.partyBotDelayMs+steps*stepMs;
        }else if(!last){
          delay=Math.round(this.partyBotDelayMs*0.55);
        }else if(last.side===game.turn){
          delay=Math.round(this.partyBotDelayMs*0.45);
        }else{
          delay=Math.round(this.partyBotDelayMs*0.35);
        }
        this.scheduleDelayed(game.id,delay);
      }else this.schedule(game.id);
    }
  }
  scheduleDelayed(id,delayMs){
    if(this.closed)return;
    clearTimeout(this.delayTimers.get(id));
    const timer=setTimeout(()=>{this.delayTimers.delete(id);if(!this.closed)this.schedule(id);},delayMs);
    timer.unref();
    this.delayTimers.set(id,timer);
  }
  async get(id,actor){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))throw new GameError('Không tìm thấy ván luyện tập.',404);const {rows}=await this.db.query('SELECT state,updated_at FROM practice_games WHERE id=$1 AND player_id=$2',[id,actor]);if(!rows[0])throw new GameError('Không tìm thấy ván hoặc bạn không có quyền xem.',404);if(this.inactivityMs>0&&Date.now()-Number(rows[0].updated_at)>=this.inactivityMs){await this.ensureActive(id);}const state=rows[0].state;if(state.phase==='playing'&&state.turn!==state.humanSide&&!this.delayTimers.has(id))this.schedule(id);return practiceView(state);}
  async list(actor){await this.pruneInactive();const {rows}=await this.db.query("SELECT state - ARRAY['board','initialBoard','moves','repetitions','seenPositions','party','initialParty'] AS state,jsonb_array_length(state->'moves') AS move_count FROM practice_games WHERE player_id=$1 ORDER BY updated_at DESC LIMIT 20",[actor]);return rows.map(({state:g,move_count})=>({id:g.id,kind:g.kind,difficulty:g.difficulty,humanSide:g.humanSide,phase:g.phase,result:g.result,moves:move_count,createdAt:g.createdAt,ranked:!!g.ranked,bot:g.bot,ratingChange:g.ratingChange}));}
  async act(id,actor,body){
    const {actionId,version,action,from=null,to,promotion,pass,command,details}=body;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actionId||'')||!Number.isInteger(version))throw new GameError('Yêu cầu không hợp lệ.');
    await this.ensureActive(id);
    const hash=digest(JSON.stringify({version,action,from,to,promotion,pass,command,details}));
    const {game,player}=await this.db.transaction(async client=>{
      const row=await this.read(id,actor,client,true);let game=row.state;
      const {rows}=await client.query('SELECT request_hash FROM practice_receipts WHERE game_id=$1 AND action_id=$2',[id,actionId]);
      if(rows[0]){if(rows[0].request_hash!==hash)throw new GameError('Mã thao tác đã được sử dụng.',409);return {game,player:row.player_id};}
      if(game.version!==version)throw new GameError('Bàn cờ vừa cập nhật. Hãy chọn lại nước đi.',409);
      if(action==='undo'){if(game.ranked)throw new GameError('Ván xếp hạng không được đi lại.',409);clearTimeout(this.delayTimers.get(id));this.delayTimers.delete(id);game=undoHumanTurn(game);}
      else if(action==='resign'){if(game.phase!=='playing')throw new GameError('Ván đã kết thúc.',409);clearTimeout(this.delayTimers.get(id));this.delayTimers.delete(id);endPractice(game,oppositeSide(game.kind,game.humanSide),'resign');}
      else if(action==='move'){if(game.turn!==game.humanSide)throw new GameError('Máy đang suy nghĩ. Chờ một chút nhé.',409);makePracticeMove(game,{from,to,promotion,pass,details,action:command});}
      else throw new GameError('Thao tác không được hỗ trợ.');
      await this.persist(client,game,row.player_id);await client.query('INSERT INTO practice_receipts(game_id,action_id,request_hash,created_at) VALUES($1,$2,$3,$4)',[id,actionId,hash,Date.now()]);
      return {game,player:row.player_id};
    });
    this.changed(game,player);return practiceView(game);
  }
  schedule(id){if(this.closed||this.pending.has(id))return;this.pending.add(id);this.queue.push(id);this.pump();}
  pump(){while(!this.closed&&this.running<this.botWorkers&&this.queue.length){const id=this.queue.shift();this.running++;this.runBot(id).catch(error=>console.error('Practice bot:',error.message)).finally(async()=>{this.pending.delete(id);this.running--;const attemptedVersion=this.attemptedVersions.get(id);this.attemptedVersions.delete(id);if(!this.closed&&!this.delayTimers.has(id)){try{const {state}=await this.read(id);if(!this.closed&&!this.delayTimers.has(id)&&state.version!==attemptedVersion&&state.phase==='playing'&&state.turn!==state.humanSide)this.schedule(id);}catch{}}this.pump();});}}
  async runBot(id){
    const {state:snapshot}=await this.read(id);if(this.closed||snapshot.phase!=='playing'||snapshot.turn===snapshot.humanSide)return;
    this.attemptedVersions.set(id,snapshot.version);
    let move,engine;
    try{const answer=await this.nativeBots.chooseMove(snapshot);if(answer){move=answer.move;engine=answer.engine;}}
    catch(error){if(!this.closed&&!this.engineWarnings.has(snapshot.kind)){this.engineWarnings.add(snapshot.kind);console.warn(`Native ${snapshot.kind} engine unavailable; using internal bot: ${error.message}`);}}
    if(this.closed)return;
    if(!move)try{move=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./bot-worker.js',import.meta.url),{workerData:snapshot});this.workers.add(worker);
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('Bot computation deadline'));},2500);
      const finish=()=>{clearTimeout(timer);this.workers.delete(worker);};
      // Node --watch also posts dependency-tracking messages on this channel.
      // Only our explicit envelope contains a playable bot result.
      worker.on('message',value=>{if(value?.type!=='sanco-bot-move')return;finish();resolve(value.move);});worker.once('error',error=>{finish();reject(error);});worker.once('exit',code=>{finish();if(code!==0)reject(new Error('Bot worker stopped'));});
    });}catch(error){if(this.closed)return;move=legalMoves(snapshot)[0];}
    if(this.closed)return;
    const candidates=legalMoves(snapshot);
    if(!move||!candidates.some(candidate=>candidate.from===move.from&&candidate.to===move.to&&candidate.promotion===move.promotion&&candidate.action===move.action&&!!candidate.pass===!!move.pass))move=candidates[0];
    if(!move)return;
    const output=await this.db.transaction(async client=>{
      if(this.closed)return null;
      const row=await this.read(id,null,client,true),game=row.state;
      if(game.version!==snapshot.version||game.phase!=='playing'||game.turn===game.humanSide)return null;
      if(engine)game.botEngine=engine;else delete game.botEngine;
      makePracticeMove(game,move);await this.persist(client,game,row.player_id);return {game,actor:row.player_id};
    });
    if(output)this.changed(output.game,output.actor);
  }
  async close(){this.closed=true;clearTimeout(this.sweepTimer);this.sweepTimer=null;for(const t of this.delayTimers.values())clearTimeout(t);this.delayTimers.clear();this.queue=[];await Promise.all([this.nativeBots.close(),...[...this.workers].map(worker=>worker.terminate())]);}
}
