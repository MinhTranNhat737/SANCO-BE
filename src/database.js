import { readFile, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export async function openDatabase({ url = process.env.DATABASE_URL, directory = process.env.DATA_DIR || path.join(projectRoot, '.data', 'postgres'), memory = false } = {}) {
  if(memory)url=undefined;
  let database;
  if (url) {
    const { Pool } = await import('pg');
    const max=Number(process.env.DB_POOL_MAX||10);
    if(!Number.isInteger(max)||max<1||max>100)throw new Error('DB_POOL_MAX must be an integer from 1 to 100');
    const pool = new Pool({ connectionString: url, max, connectionTimeoutMillis:5000,idleTimeoutMillis:30000,statement_timeout:10000,application_name:'sanco' });
    database = {
      query: (text, values = []) => pool.query(text, values),
      async transaction(fn) {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const out = await fn(client); await client.query('COMMIT'); return out; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      }, close: () => pool.end(), kind: 'PostgreSQL',
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    if (!memory) await mkdir(directory, { recursive: true });
    const db = new PGlite(memory ? undefined : directory);
    await db.waitReady;
    database = { query: (text, values = []) => db.query(text, values), transaction: fn => db.transaction(fn), close: () => db.close(), kind: 'PostgreSQL embedded (PGlite)' };
  }
  await migrateDatabase(database,!!url);
  return database;
}
export async function migrateDatabase(database,postgres=false){
  await database.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)');
  const migrationDirectory = new URL('../sql/', import.meta.url);
  for (const file of (await readdir(migrationDirectory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
    const sql = await readFile(new URL(file, migrationDirectory), 'utf8');
    await database.transaction(async client=>{
      if(postgres)await client.query('SELECT pg_advisory_xact_lock(894310129)');
      const {rows}=await client.query('SELECT name FROM schema_migrations WHERE name=$1',[file]);if(rows.length)return;
      if(postgres)await client.query(sql);
      else for(const statement of sql.split(';').filter(s=>s.trim()))await client.query(statement);
      await client.query('INSERT INTO schema_migrations(name,applied_at) VALUES($1,$2)',[file,Date.now()]);
    });
  }
}
