import { GUEST_IDLE_MS } from './auth.js';

// Guest participants are temporary game infrastructure, never account records.
export class GuestSessions {
  constructor(db, online = () => false, { graceMs = 90000 } = {}) {
    this.db=db;this.online=online;this.graceMs=graceMs;this.timers=new Map();this.running=false;this.closed=false;
  }
  async remove(id,{now=Date.now(),disconnectedAt,force=false}={}) {
    if(this.closed||this.online(id))return false;
    return this.db.transaction(async client=>{
      const {rows}=await client.query('SELECT account_id FROM players WHERE id=$1 FOR UPDATE',[id]);
      if(!rows.length||rows[0].account_id||this.online(id))return false;
      // Finish or prune games through their normal services before dropping a participant.
      const linked=await client.query(`SELECT EXISTS(SELECT 1 FROM rooms WHERE owner_id=$1 OR guest_id=$1 OR id IN (SELECT room_id FROM room_members WHERE player_id=$1))
        OR EXISTS(SELECT 1 FROM practice_games WHERE player_id=$1) AS present`,[id]);
      if(linked.rows[0].present)return false;
      if(!force){
        const sessions=await client.query('SELECT MAX(COALESCE(last_seen_at,created_at)) AS seen FROM sessions WHERE player_id=$1 AND expires_at>$2',[id,now]);
        const seen=sessions.rows[0].seen;
        if(seen!==null && Number(seen) > (disconnectedAt ?? now-GUEST_IDLE_MS))return false;
      }
      await client.query('DELETE FROM players WHERE id=$1 AND account_id IS NULL',[id]);
      return true;
    });
  }
  prune({now=Date.now(),force=false}={}) {
    if(this.closed||this.running)return Promise.resolve(0);
    this.running=true;
    this.pending=(async()=>{try{
      const {rows}=await this.db.query(`SELECT p.id FROM players p WHERE p.account_id IS NULL
        ${force?'':`AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.player_id=p.id AND s.expires_at>$1 AND COALESCE(s.last_seen_at,s.created_at)>$2)`}
        ORDER BY p.created_at,p.id LIMIT 1000`,force?[]:[now,now-GUEST_IDLE_MS]);
      let removed=0;for(const {id} of rows)if(await this.remove(id,{now,force}))removed++;
      return removed;
    }finally{this.running=false;}})();
    return this.pending;
  }
  disconnected(id) {
    if(this.closed||this.online(id))return;
    clearTimeout(this.timers.get(id));const disconnectedAt=Date.now();
    const timer=setTimeout(()=>{this.timers.delete(id);void this.remove(id,{disconnectedAt}).catch(error=>console.error('Guest cleanup:',error.message));},this.graceMs);
    timer.unref();this.timers.set(id,timer);
  }
  async close(){this.closed=true;for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();await this.pending?.catch(()=>{});}
}
