import 'dotenv/config';
import { openDatabase } from '../src/database.js';
import {
  DEFAULT_UPDATE_CAMPAIGN_ID,
  buildUpdateEmail,
  createGmailTransporter,
  gmailConfigStatus,
  normalizeEmail,
  sendUpdateCampaign,
} from '../src/update-mail-service.js';

function parseArgs(argv) {
  const args = { send: false, dryRun: false, to: null, campaignId: DEFAULT_UPDATE_CAMPAIGN_ID, delayMs: 1200, limit: undefined };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--send') args.send = true;
    else if (token === '--dry-run') args.dryRun = true;
    else if (token === '--to' && argv[i + 1]) args.to = argv[++i];
    else if (token.startsWith('--to=')) args.to = token.slice(5);
    else if (token === '--campaign' && argv[i + 1]) args.campaignId = argv[++i];
    else if (token.startsWith('--campaign=')) args.campaignId = token.slice(11);
    else if (token.startsWith('--delay=')) args.delayMs = Math.max(0, Number(token.slice(8)) || 0);
    else if (token.startsWith('--limit=')) args.limit = Math.max(1, Number(token.slice(8)) || 1);
  }
  if (!args.send && !args.to) args.dryRun = true;
  return args;
}

const args = parseArgs(process.argv.slice(2));
const siteUrl = process.env.FRONTEND_SITE_URL || 'https://www.sanco.games';

if (args.to) {
  const target = normalizeEmail(args.to);
  if (!target) {
    console.error('Email đích (--to) không hợp lệ:', args.to);
    process.exit(1);
  }
  const cfg = gmailConfigStatus();
  if (args.dryRun) {
    const preview = buildUpdateEmail({ playerName: 'Bạn cờ', siteUrl });
    console.log(JSON.stringify({ mode: 'test-dry-run', to: target, gmailConfigured: cfg.configured, subject: preview.subject }, null, 2));
    process.exit(0);
  }
  const transporter = createGmailTransporter();
  await transporter.verify();
  const result = await sendUpdateCampaign({
    transporter,
    campaignId: `${args.campaignId}:test`,
    recipients: [{ email: target, displayName: 'Bạn cờ' }],
    dryRun: false,
    delayMs: 0,
    from: cfg.from,
    siteUrl,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failed ? 1 : 0);
}

const db = await openDatabase();
try {
  const cfg = gmailConfigStatus();
  const transporter = args.dryRun ? null : createGmailTransporter();
  if (transporter) await transporter.verify();
  const result = await sendUpdateCampaign({
    db,
    transporter,
    campaignId: args.campaignId,
    dryRun: args.dryRun,
    delayMs: args.delayMs,
    from: cfg.from,
    siteUrl,
    limit: args.limit,
  });
  console.log(JSON.stringify({ ...result, gmailConfigured: cfg.configured }, null, 2));
  if (result.failed > 0) process.exitCode = 1;
} finally {
  await db.close();
}
