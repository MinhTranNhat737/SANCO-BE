import 'dotenv/config';
import { createApplication } from './app.js';
if(process.env.NODE_ENV==='production'&&!process.env.DATABASE_URL)throw new Error('Production requires DATABASE_URL pointing to PostgreSQL.');
const application = await createApplication();
const port = Number(process.env.PORT || 3001);
application.server.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Sân Cờ API: http://${process.env.HOST || '127.0.0.1'}:${port}`);
  console.log(`Database: ${application.db.kind}`);
});
let stopping = false;
async function shutdown() { if (stopping) return; stopping = true; await application.close(); process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
