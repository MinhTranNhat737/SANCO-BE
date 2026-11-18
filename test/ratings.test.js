import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {createGuest} from '../src/auth.js';
import {RoomService} from '../src/rooms.js';
import {PracticeService} from '../src/practice.js';
import {KINDS,createPractice,boardSide,legalMoves} from '../src/practice-engine.js';
import {chooseBotMove} from '../src/bot.js';
import {createApplication} from '../src/app.js';
import {ratingView,eloDelta,settleRating,playerRatings,botRoster,selectBot,leaderboard} from '../src/ratings.js';

let db,rooms,practice;
before(async()=>{
  db=await openDatabase({memory:true});rooms=new RoomService(db,()=>{},()=>false,{inactivityMs:0});
  practice=new PracticeService(db,()=>{},{inactivityMs:0});practice.schedule=()=>{};
});
after(async()=>{rooms.close();await practice.close();await db.close();});
const guest=()=>createGuest(db);
const settle=(kind,participants,winner,id=randomUUID())=>db.transaction(client=>settleRating(client,{id,kind,source:'room',participants,winner}));
const act=(room,actor,action)=>rooms.act(room.id,actor.id,{actionId:randomUUID(),version:room.version,action});

test('Elo rewards upsets, treats draws fairly and places each game independently',async()=>{
  assert.equal(eloDelta(1000,1000,1),12);assert.equal(eloDelta(1000,1000,0),-12);assert.equal(eloDelta(1000,1000,.5),0);
  assert.equal(eloDelta(1000,1000,1,0),20);assert.ok(eloDelta(800,1400,1)>eloDelta(1400,800,1));
  const p=await guest(),q=await guest(),participants=[{id:p.id,mark:'w'},{id:q.id,mark:'b'}];
  const before=await playerRatings(db,p.id);assert.equal(Object.keys(before).length,16);assert.equal(before.chess.rank,'Chưa xếp hạng');
  await settle('chess',participants,'w');const after=await playerRatings(db,p.id);
  assert.equal(after.chess.elo,1020);assert.equal(after.chess.games,1);assert.equal(after.caro.elo,1000);assert.equal(after.xiangqi.games,0);
  for(let n=0;n<9;n++)await settle('chess',participants,null);
  const placed=(await playerRatings(db,p.id)).chess;assert.equal(placed.provisional,false);assert.equal(placed.rank,placed.tier);
  assert.ok((await leaderboard(db,'chess')).some(row=>row.name===p.display_name));
});

test('Settlement retries, concurrent finishes and rollback never duplicate or lose Elo',async()=>{
  const p=await guest(),q=await guest(),participants=[{id:p.id,mark:'X'},{id:q.id,mark:'O'}],id=randomUUID();
  const first=await settle('caro',participants,'X',id);
  assert.deepEqual(await settle('caro',participants,'O',id),first);
  assert.equal((await playerRatings(db,p.id)).caro.games,1);
  await Promise.all([settle('caro',participants,'X'),settle('caro',[...participants].reverse(),'O')]);
  assert.equal((await playerRatings(db,p.id)).caro.games,3);
  assert.equal((await playerRatings(db,q.id)).caro.games,3);
  const rolledBack=randomUUID();await assert.rejects(db.transaction(async client=>{await settleRating(client,{id:rolledBack,kind:'caro',source:'room',participants,winner:'X'});throw Error('abort finish');}));
  assert.equal((await playerRatings(db,p.id)).caro.games,3);
  assert.equal((await db.query('SELECT game_id FROM rating_settlements WHERE game_id=$1',[rolledBack])).rows.length,0);
});

test('Multiplayer results update every seat and keep pre-match ratings for all pairings',async()=>{
  const participants=await Promise.all(['R','G','Y','B'].map(async mark=>({id:(await guest()).id,mark})));
  const changes=await settle('monopoly',participants,'Y');
  assert.equal(changes.Y.delta,20);assert.equal(changes.R.delta,-7);assert.equal(changes.G.delta,-7);assert.equal(changes.B.delta,-7);
  for(const p of participants){const profile=(await playerRatings(db,p.id)).monopoly;assert.equal(profile.games,1);assert.equal(profile.wins,p.mark==='Y'?1:0);}
});

test('Rated rooms settle resignation, rematch and clock expiry once; friendly rooms do not rate',async()=>{
  const a=await guest(),b=await guest();let created=await rooms.create(a,3,'caro','first',2,true);
  let room=await rooms.join(created.room.id,b,created.token);room=await act(room,a,'ready');room=await act(room,b,'ready');
  const body={actionId:randomUUID(),version:room.version,action:'resign'};
  const ended=await rooms.act(room.id,b.id,body);assert.equal(ended.game.ratingChanges.X.delta,20);
  await rooms.act(room.id,b.id,body);assert.equal((await playerRatings(db,a.id)).caro.games,1);
  room=await act(ended,a,'rematch');room=await act(room,b,'rematch');assert.equal(room.game.ratingChanges,undefined);
  room=await act(room,a,'ready');room=await act(room,b,'ready');
  const state=await rooms.read(room.id);state.game.turnStartedAt=Date.now()-state.duration-10;
  await db.query('UPDATE rooms SET state=$1 WHERE id=$2',[JSON.stringify(state),room.id]);
  await rooms.expire(room.id);await rooms.expire(room.id);assert.equal((await playerRatings(db,a.id)).caro.games,2);
  created=await rooms.create(a,3,'chess','first',2,false);room=await rooms.join(created.room.id,b,created.token);room=await act(room,a,'ready');room=await act(room,b,'ready');await act(room,b,'resign');
  assert.equal((await playerRatings(db,a.id)).chess.games,0);
});

test('All 192 bot profiles belong to one game, span Elo levels and make legal moves',()=>{
  const ids=new Set();
  for(const kind of KINDS){
    const roster=botRoster(kind);assert.equal(roster.length,12);assert.equal(roster[0].elo,400);assert.equal(roster.at(-1).elo,2050);
    for(const bot of roster){assert.ok(!ids.has(bot.id));ids.add(bot.id);}
    assert.throws(()=>selectBot(kind,1000,'wrong-game-bot'));
    for(let n=0;n<8;n++)assert.ok(Math.abs(selectBot(kind,1000).elo-1000)<=150);
    for(const bot of [roster[0],roster[5],roster.at(-1)]){
      const game=createPractice(kind,boardSide(kind),bot.difficulty,randomUUID());game.bot=bot;
      const move=chooseBotMove(game);assert.ok(legalMoves(game).some(m=>JSON.stringify(m)===JSON.stringify(move)),`${kind}: ${bot.elo} returned a legal move`);
    }
  }
  assert.equal(ids.size,192);
});

test('Ranked bot games resume active matches, block undo and settle resignation/idempotent retry',async()=>{
  const p=await guest(),roster=botRoster('chess');
  let game=await practice.create(p,{kind:'chess',ranked:true,botId:roster[4].id});
  assert.equal(game.bot.elo,1000);assert.equal(game.ranked,true);
  const resumed=await practice.create(p,{kind:'chess',ranked:true,botId:roster[0].id});assert.equal(resumed.id,game.id);
  await assert.rejects(practice.act(game.id,p.id,{actionId:randomUUID(),version:game.version,action:'undo'}),/không được đi lại/);
  const body={actionId:randomUUID(),version:game.version,action:'resign'};
  game=await practice.act(game.id,p.id,body);assert.equal(game.ratingChange.delta,-20);
  assert.equal((await practice.act(game.id,p.id,body)).ratingChange.after,980);assert.equal((await playerRatings(db,p.id)).chess.games,1);
  const casual=await practice.create(p,{kind:'caro',difficulty:'easy'});await practice.act(casual.id,p.id,{actionId:randomUUID(),version:casual.version,action:'resign'});
  assert.equal((await playerRatings(db,p.id)).caro.games,0);
});

test('Abandoning a ranked bot game records a loss before cleanup; live ranked room cannot be erased',async()=>{
  const p=await guest(),q=await guest(),game=await practice.create(p,{kind:'caro',ranked:true});
  await db.query('UPDATE practice_games SET updated_at=$1 WHERE id=$2',[1,game.id]);
  await practice.cancelInactiveGame(game.id,Date.now());await practice.cancelInactiveGame(game.id,Date.now());
  assert.equal((await playerRatings(db,p.id)).caro.losses,1);
  const created=await rooms.create(p,3,'chess','first',2,true);let room=await rooms.join(created.room.id,q,created.token);room=await act(room,p,'ready');room=await act(room,q,'ready');
  await db.query('UPDATE rooms SET updated_at=$1 WHERE id=$2',[1,room.id]);
  assert.equal(await rooms.cancelInactiveRoom(room.id,Date.now()),null);assert.equal((await rooms.get(room.id,p.id)).game.phase,'playing');
});

test('Authenticated rank APIs validate input, resume concurrent requests and serve independent worker games',async()=>{
  const app=await createApplication({database:{memory:true},disableRateLimits:true,inactivityMs:0});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${app.server.address().port}/api`;
  const makeClient=()=>{let cookie='';return async(path,body)=>{
    const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,...await response.json()};
  };};
  try{
    const a=makeClient(),b=makeClient();assert.equal((await a('/ratings')).status,401);await a('/me');await b('/me');
    assert.equal((await a('/ratings')).ratings.monopoly.elo,1000);assert.equal((await a('/bots/monopoly')).bots.length,12);
    assert.equal((await a('/bots/unknown')).status,400);assert.equal((await a('/leaderboard/unknown')).status,400);
    assert.equal((await a('/practice',{kind:'chess',ranked:'true'})).status,400);
    assert.equal((await a('/practice',{kind:'chess',ranked:true,botId:'caro-bot-1000'})).status,400);
    const same=await Promise.all([a('/practice',{kind:'chess',ranked:true,botId:'chess-bot-1000'}),a('/practice',{kind:'chess',ranked:true})]);
    assert.equal(same[0].game.id,same[1].game.id);
    const another=await b('/practice',{kind:'chess',ranked:true,botId:'chess-bot-1000',elo:9999});
    assert.notEqual(another.game.id,same[0].game.id);assert.equal(another.game.bot.elo,1000);
    await Promise.all([[a,same[0].game],[b,another.game]].map(async([call,initial])=>{
      let game=(await call(`/practice/${initial.id}`)).game;
      if(!game.thinking){const move=game.legal[0];const response=await call(`/practice/${game.id}/actions`,{...move,action:'move',actionId:randomUUID(),version:game.version});assert.equal(response.status,200);game=response.game;}
      for(let n=0;n<100&&game.thinking;n++){await new Promise(resolve=>setTimeout(resolve,30));game=(await call(`/practice/${game.id}`)).game;}
      assert.equal(game.thinking,false);assert.ok(game.moves.some(move=>move.side!==game.humanSide));
      const body={action:'resign',actionId:randomUUID(),version:game.version};
      const finished=await call(`/practice/${game.id}/actions`,body);assert.equal(finished.status,200);assert.equal(finished.game.ratingChange.delta,-20);
      assert.equal((await call(`/practice/${game.id}/actions`,body)).status,200);
      const profile=(await call('/ratings')).ratings;assert.equal(profile.chess.games,1);assert.equal(profile.chess.elo,980);assert.equal(profile.caro.games,0);
    }));
  }finally{await app.close();}
});
