import 'dotenv/config';
import { openDatabase } from './database.js';
const db = await openDatabase();
console.log(`SQL migration applied: ${db.kind}`);
await db.close();
