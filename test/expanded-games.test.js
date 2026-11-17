import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPractice,legalMoves,makePracticeMove} from '../src/practice-engine.js';
import {goPlay,goScore} from '../src/grid-games.js';
import {partyMove,partyLegal,newParty} from '../src/party-games.js';
import {chooseBotMove} from '../src/bot.js';
import {lookupChessBook,lookupXiangqiBook,lookupCaroBook,lookupReversiBook} from '../src/openings.js';
import {openDatabase,migrateDatabase} from '../src/database.js';
const create=kind=>createPractice(kind,kind==='tictactoe'?'X':['ludo','monopoly'].includes(kind)?'R':'B','medium',randomUUID());
test('Go captures chains, rejects suicide and positional superko',()=>{
  const board=Array(81).fill(null);for(const i of[31,32,39,42,49])board[i]='B';board[40]='W';board[41]='W';
  const out=goPlay(board,50,'B');assert.deepEqual(out.captured.sort(),[40,41]);assert.equal(out.board[40],null);
  assert.equal(goPlay(board,50,'B',{[out.key]:true}),null);
  const suicide=Array(81).fill(null);for(const i of[31,39,41,49])suicide[i]='W';assert.equal(goPlay(suicide,40,'B'),null);
});
test('Two Go passes finish by area with komi; undo and invalid pass remain controlled',()=>{
  const g=create('go');assert.throws(()=>makePracticeMove(g,{to:-1}),/hợp lệ/);
  makePracticeMove(g,{from:null,to:-1,pass:true});assert.equal(g.phase,'playing');makePracticeMove(g,{from:null,to:-1,pass:true});
  assert.equal(g.result.reason,'area');assert.equal(g.result.winner,'W');assert.deepEqual(goScore(Array(81).fill(null)),{B:0,W:6.5,komi:6.5});
});
test('English draughts requires captures, completes a multi-jump, and stops on crowning',()=>{
  const g=create('checkers');assert.equal(g.board.filter(Boolean).length,24);g.board=Array(64).fill(null);g.board[42]='BM';for(const i of[33,17,8])g.board[i]='WM';
  assert.deepEqual(legalMoves(g),[{from:42,to:24}]);assert.throws(()=>makePracticeMove(g,{from:42,to:35}),/hợp lệ/);
  makePracticeMove(g,{from:42,to:24});assert.equal(g.turn,'B');assert.equal(g.forcedFrom,24);assert.equal(g.board[33],null);
  makePracticeMove(g,{from:24,to:10});assert.equal(g.turn,'W');assert.equal(g.forcedFrom,null);assert.equal(g.board[17],null);
  const promotion=create('checkers');promotion.board=Array(64).fill(null);promotion.board[10]='BM';promotion.board[8]='WM';makePracticeMove(promotion,{from:10,to:1});assert.equal(promotion.board[1],'BK');assert.equal(promotion.turn,'W');
});
test('Tic-tac-toe validates turns and bot takes an immediate win',()=>{
  const g=create('tictactoe');g.board=['X','X',null,'O','O',null,null,null,null];assert.equal(chooseBotMove(g).to,2);makePracticeMove(g,{to:2});assert.equal(g.result.winner,'X');assert.equal(g.result.reason,'three');
});
test('Ludo requires six, grants extra roll, captures safely, and exact home wins',()=>{
  const g=create('ludo');partyMove(g,{action:'roll'},()=>1);assert.equal(g.turn,'G');g.turn='R';g.party.stage='roll';partyMove(g,{action:'roll'},()=>6);assert.equal(partyLegal(g).length,4);
  partyMove(g,{action:'move',to:0});assert.equal(g.party.players[0].tokens[0],0);assert.equal(g.turn,'R');assert.equal(g.party.stage,'roll');
  const [red,green]=g.party.players;red.tokens=[3,-1,-1,-1];green.tokens=[43,-1,-1,-1];g.party.dice=1;g.party.stage='move';partyMove(g,{action:'move',to:0});assert.equal(green.tokens[0],-1);
  g.turn='R';red.tokens=[7,-1,-1,-1];green.tokens=[47,-1,-1,-1];g.party.dice=1;g.party.stage='move';partyMove(g,{action:'move',to:0});assert.equal(green.tokens[0],47);
  g.turn='R';red.tokens=[57,57,57,56];g.party.dice=2;g.party.stage='move';assert.equal(partyLegal(g).length,0);g.party.dice=1;partyMove(g,{action:'move',to:3});assert.equal(g.result.winner,'R');assert.equal(g.result.reason,'home');
});
test('Mini estate buys, builds evenly, sells, charges rent and resolves bankruptcy',()=>{
  const g=create('monopoly');g.party=newParty('monopoly',2,true);const p=g.party,red=p.players[0],green=p.players[1];red.position=1;p.stage='buy';
  assert.ok(partyLegal(g).some(m=>m.action==='buy'));partyMove(g,{action:'buy',to:1});assert.equal(red.cash,1380);assert.equal(p.property[1],'R');
  p.property[2]='R';assert.ok(partyLegal(g).some(m=>m.action==='build'&&m.to===1));partyMove(g,{action:'build',to:1});assert.equal(p.houses[1],1);assert.equal(partyLegal(g).some(m=>m.action==='build'&&m.to===1),false);
  const cash=red.cash;partyMove(g,{action:'sell',to:1});assert.equal(red.cash,cash+110);assert.equal(p.property[1],null);
  p.property[1]='R';g.turn='G';p.stage='roll';const before=green.cash;partyMove(g,{action:'roll'},()=>1);assert.equal(green.cash,before-18);
  green.position=4;green.cash=0;p.stage='roll';partyMove(g,{action:'roll'},()=>1);assert.equal(p.stage,'debt');partyMove(g,{action:'bankrupt'});assert.equal(g.phase,'finished');assert.equal(g.result.winner,'R');
});
test('All five new bots produce playable server-validated actions',()=>{
  for(const kind of['go','checkers','tictactoe','ludo','monopoly']){const g=create(kind),move=chooseBotMove(g);assert.ok(move);makePracticeMove(g,move);assert.equal(g.moves.length,1);}
});
test('Opening books provide diverse playbooks and tactical engines solve key threats across all bots',()=>{
  const chessOpenings=new Set(),xiangqiOpenings=new Set();
  for(let i=0;i<24;i++){
    const cg=createPractice('chess','w','hard',`seed-chess-${i}`);
    const xg=createPractice('xiangqi','r','hard',`seed-xiangqi-${i}`);
    const cm=lookupChessBook(cg),xm=lookupXiangqiBook(xg);
    assert.ok(cm&&xm);
    chessOpenings.add(`${cm.from}:${cm.to}`);
    xiangqiOpenings.add(`${xm.from}:${xm.to}`);
  }
  assert.ok(chessOpenings.size>=3,'Chess opening book must offer multiple grandmaster playbooks');
  assert.ok(xiangqiOpenings.size>=3,'Xiangqi opening book must offer multiple classical playbooks');

  // Go bot rescues its own chain in Atari instead of passing or playing randomly
  const goGame=create('go');goGame.board=Array(81).fill(null);
  goGame.board[40]='B';goGame.board[31]='W';goGame.board[39]='W';goGame.board[41]='W';
  const goMove=chooseBotMove(goGame);assert.equal(goMove.to,49);

  // Ludo bot prioritizes capturing an opponent token on a non-safe square
  const ludoGame=create('ludo');
  ludoGame.party.players[0].tokens=[3,10,-1,-1];
  ludoGame.party.players[1].tokens=[43,-1,-1,-1]; // Global 4: (43 + 13) % 52 = 4
  ludoGame.party.dice=1;ludoGame.party.stage='move';
  const ludoChoice=chooseBotMove(ludoGame);assert.equal(ludoChoice.to,0);
});
test('Migration replay keeps expanded game rows and applies each schema file once',async()=>{
  const db=await openDatabase({memory:true});
  try{
    const player=randomUUID(),id=randomUUID();await db.query('INSERT INTO players(id,display_name,created_at) VALUES($1,$2,$3)',[player,'Migration',Date.now()]);
    await db.query('INSERT INTO practice_games(id,player_id,kind,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)',[id,player,'go',JSON.stringify(create('go')),Date.now()]);
    const before=(await db.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n;
    await migrateDatabase(db);await migrateDatabase(db);
    assert.equal((await db.query('SELECT kind FROM practice_games WHERE id=$1',[id])).rows[0].kind,'go');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n,before);
  }finally{await db.close();}
});
