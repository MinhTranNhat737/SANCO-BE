import 'dotenv/config';
import { openDatabase } from '../src/database.js';
import { audit } from '../src/admin.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run admin:grant -- owner@example.com');
  process.exitCode = 1;
} else {
  const db = await openDatabase();
  try {
    await db.transaction(async client => {
      await client.query('SELECT id FROM site_settings WHERE id=1 FOR UPDATE');
      const { rows } = await client.query('SELECT p.id,p.suspended_at FROM players p JOIN accounts a ON a.id=p.account_id WHERE a.email=$1 FOR UPDATE', [email]);
      if (!rows.length) throw new Error('Account not found. Register or sign in on the website first.');
      if (rows[0].suspended_at) throw new Error('Account is suspended. Restore it before granting admin.');
      await client.query('UPDATE players SET is_admin=TRUE WHERE id=$1', [rows[0].id]);
      await audit(client, null, 'admin.bootstrap', rows[0].id, { source: 'server-cli' });
    });
    console.log('Admin access granted. Refresh the website, then open /admin.');
  } finally { await db.close(); }
}
