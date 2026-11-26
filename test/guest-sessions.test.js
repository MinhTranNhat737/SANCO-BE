import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../src/database.js';
import {GuestSessions} from '../src/guest-sessions.js';
import {createGuest,issueSession,sessionFor,GUEST_IDLE_MS} from '../src/auth.js';
import {createApplication} from '../src/app.js';

async function seeded(db,{account=false,ago=0}={}){
  const player=await createGuest(db),now=Date.now();let cookie,options;
  if(account){const id=randomUUID();await db.query('INSERT INTO accounts(id,email,created_at) VALUES($1,$2,$3)',[id,id+'@example.test',now]);await db.query('UPDATE players SET account_id=$1 WHERE id=$2',[id,player.id]);}
  await issueSession(db,{cookie(_name,value,settings){cookie='sc_session='+value;options=settings;}},player.id,null,false);
  if(ago)await db.query('UPDATE sessions SET last_seen_at=$1 WHERE player_id=$2',[now-ago,player.id]);
  return {...player,cookie,options};
}
test('Guest cookies are session-only; account cookies keep their persistent lifetime',async()=>{
  const db=await openDatabase({memory:true});try{
    const guest=await seeded(db),account=await seeded(db,{account:true});
    assert.equal(guest.options.maxAge,undefined);assert.equal(account.options.maxAge,30*86400000);
    await db.query('UPDATE sessions SET last_seen_at=$1 WHERE player_id=$2',[Date.now()-GUEST_IDLE_MS-1,guest.id]);
    assert.equal(await sessionFor(db,{headers:{cookie:guest.cookie}}),null);
    assert.ok(await sessionFor(db,{headers:{cookie:account.cookie}}));
  }finally{await db.close();}
});
test('Cleanup removes stale guest participants, cascades sessions and preserves accounts and fresh/online guests',async()=>{
  const db=await openDatabase({memory:true});try{
    const stale=await seeded(db,{ago:GUEST_IDLE_MS+1000}),fresh=await seeded(db),account=await seeded(db,{account:true,ago:GUEST_IDLE_MS+1000}),online=await seeded(db,{ago:GUEST_IDLE_MS+1000});
    const cleanup=new GuestSessions(db,id=>id===online.id);
    assert.equal(await cleanup.prune(),1);
    assert.equal((await db.query('SELECT id FROM players WHERE id=$1',[stale.id])).rows.length,0);
    assert.equal((await db.query('SELECT player_id FROM sessions WHERE player_id=$1',[stale.id])).rows.length,0);
    for(const p of [fresh,account,online])assert.equal((await db.query('SELECT id FROM players WHERE id=$1',[p.id])).rows.length,1);
    cleanup.close();
  }finally{await db.close();}
});
test('Guest removal preserves replay snapshots, reports and account history, and protects guests promoted to accounts',async()=>{
  const db=await openDatabase({memory:true});try{
    const guest=await seeded(db,{ago:GUEST_IDLE_MS+1000}),account=await seeded(db,{account:true});
    const match=randomUUID(),report=randomUUID(),snapshot={owner:{id:account.id,name:'Account'},guest:{id:guest.id,name:'Guest'},game:{id:match,phase:'finished'}};
    await db.query('INSERT INTO matches(id,room_id,owner_id,guest_id,rules_version,snapshot,finished_at) VALUES($1,NULL,$2,$3,$4,$5,$6)',[match,account.id,guest.id,'test',JSON.stringify(snapshot),Date.now()]);
    await db.query('INSERT INTO match_members(match_id,player_id) VALUES($1,$2),($1,$3)',[match,account.id,guest.id]);
    await db.query('INSERT INTO reports(id,player_id,body,created_at) VALUES($1,$2,$3,$4)',[report,guest.id,'A guest report remains available',Date.now()]);
    const cleanup=new GuestSessions(db);assert.equal(await cleanup.remove(guest.id),true);
    const history=(await db.query('SELECT owner_id,guest_id,snapshot FROM matches WHERE id=$1',[match])).rows[0];
    assert.equal(history.owner_id,account.id);assert.equal(history.guest_id,null);assert.deepEqual(history.snapshot,snapshot);
    assert.equal((await db.query('SELECT player_id FROM reports WHERE id=$1',[report])).rows[0].player_id,null);
    assert.equal(await cleanup.remove(account.id,{force:true}),false);cleanup.close();
  }finally{await db.close();}
});
test('Active game records and HTTP activity protect a guest during disconnect grace',async()=>{
  const db=await openDatabase({memory:true});try{
    const guest=await seeded(db,{ago:GUEST_IDLE_MS+1000}),id=randomUUID();
    await db.query('INSERT INTO practice_games(id,player_id,kind,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)',[id,guest.id,'chess','{}',Date.now()]);
    const cleanup=new GuestSessions(db);assert.equal(await cleanup.remove(guest.id,{force:true}),false);
    await db.query('DELETE FROM practice_games WHERE id=$1',[id]);
    const disconnectedAt=Date.now()-5000;await db.query('UPDATE sessions SET last_seen_at=$1 WHERE player_id=$2',[Date.now(),guest.id]);
    assert.equal(await cleanup.remove(guest.id,{disconnectedAt}),false);
    assert.equal(await cleanup.remove(guest.id,{disconnectedAt:Date.now()+1000}),true);cleanup.close();
  }finally{await db.close();}
});
test('Admin user lists and totals never include active guests while guest play and registration still work',async()=>{
  const app=await createApplication({database:{memory:true},disableRateLimits:true});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
  try{
    const response=await fetch(base+'/api/me'),cookie=response.headers.get('set-cookie').split(';')[0],guest=(await response.json()).user;
    assert.ok(guest.id);assert.equal(guest.account,false);assert.ok(!/max-age=|expires=/i.test(response.headers.get('set-cookie')));
    assert.equal((await fetch(base+'/api/practice',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({kind:'chess',difficulty:'easy',side:'first'})})).status,201);
    const admin=await seeded(app.db,{account:true});await app.db.query('UPDATE players SET is_admin=TRUE WHERE id=$1',[admin.id]);
    const listing=await (await fetch(base+'/api/admin/users',{headers:{Cookie:admin.cookie}})).json();assert.equal(listing.total,1);assert.ok(listing.items.every(p=>p.account));
    const overview=await (await fetch(base+'/api/admin/overview',{headers:{Cookie:admin.cookie}})).json();assert.equal(overview.stats.players,1);assert.equal(overview.stats.accounts,1);
    const registration=await fetch(base+'/api/auth/register',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({email:'guest-upgrade@example.test',name:'Upgraded user',password:'long-test-password'})});assert.equal(registration.status,201);assert.equal((await registration.json()).user.id,guest.id);
    assert.equal(await app.guestSessions.remove(guest.id,{force:true}),false);
  }finally{await app.close();}
});
