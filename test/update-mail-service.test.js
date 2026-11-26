import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/database.js';
import {
  DEFAULT_UPDATE_CAMPAIGN_ID,
  buildUpdateEmail,
  createGmailTransporter,
  gmailConfigStatus,
  listPlayerEmailRecipients,
  sendUpdateCampaign,
} from '../src/update-mail-service.js';

test('Update email template highlights both Monopoly 17x9 (+500/+100) and Commander Chess updates with escaped player name', () => {
  const email = buildUpdateEmail({ playerName: '<Minh & Friends>', siteUrl: 'https://www.sanco.games/' });
  assert.match(email.subject, /Cờ Tỷ Phú/);
  assert.match(email.subject, /Cờ Tư Lệnh/);
  assert.match(email.html, /&lt;Minh &amp; Friends&gt;/);
  assert.match(email.html, /17×9/);
  assert.match(email.html, /\+500 tr/);
  assert.match(email.html, /\+100 tr/);
  assert.match(email.html, /Cờ Tư Lệnh/);
  assert.match(email.html, /https:\/\/www\.sanco\.games\/\?game=monopoly/);
  assert.match(email.html, /https:\/\/www\.sanco\.games\/\?game=commander/);
  assert.match(email.text, /Xuất phát \(\+500 tr\)/);
  assert.match(email.text, /Nghỉ chân \(\+100 tr\)/);
});

test('Gmail config helper strips App Password spaces and rejects missing credentials', () => {
  assert.equal(gmailConfigStatus({}).configured, false);
  assert.throws(() => createGmailTransporter({}), /GMAIL_USER/);
  const ok = gmailConfigStatus({ GMAIL_USER: ' Sanco.Bot@gmail.com ', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', GMAIL_FROM_NAME: 'Sân Cờ' });
  assert.equal(ok.configured, true);
  assert.equal(ok.user, 'sanco.bot@gmail.com');
  assert.equal(ok.from, '"Sân Cờ" <sanco.bot@gmail.com>');
});

test('Recipient lookup deduplicates accounts/OAuth emails, skips suspended players, and campaign delivery is idempotent with error isolation', async () => {
  const db = await openDatabase({ memory: true });
  try {
    const now = Date.now();
    const acc1 = randomUUID(), acc2 = randomUUID(), acc3 = randomUUID();
    await db.query('INSERT INTO accounts(id,email,password_hash,created_at) VALUES($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)', [
      acc1, 'alice@gmail.com', 'h', now,
      acc2, 'bob@gmail.com', 'h', now,
      acc3, 'banned@gmail.com', 'h', now,
    ]);
    await db.query('INSERT INTO players(id,account_id,display_name,created_at,suspended_at) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10),($11,$12,$13,$14,$15)', [
      randomUUID(), acc1, 'Alice', now, null,
      randomUUID(), acc2, 'Bob', now, null,
      randomUUID(), acc3, 'Banned', now, now,
    ]);
    // Duplicate email in oauth_identities (different case) must not produce two entries.
    await db.query('INSERT INTO oauth_identities(provider,provider_user_id,account_id,email,created_at) VALUES($1,$2,$3,$4,$5)', [
      'google', 'g-1', acc1, 'ALICE@gmail.com', now,
    ]);

    const recipients = await listPlayerEmailRecipients(db);
    assert.deepEqual(recipients.map(r => r.email), ['alice@gmail.com', 'bob@gmail.com']);

    // Dry run sends 0 messages and records nothing.
    const dry = await sendUpdateCampaign({ db, dryRun: true, campaignId: DEFAULT_UPDATE_CAMPAIGN_ID });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.total, 2);
    assert.equal(dry.pending, 2);
    assert.equal(dry.sent, 0);

    // First real run: Bob fails temporarily, Alice succeeds.
    const delivered = [];
    let failBob = true;
    const transporter = {
      async sendMail(msg) {
        if (failBob && msg.to === 'bob@gmail.com') throw new Error('SMTP temp error');
        delivered.push(msg.to);
        return { messageId: `msg-${msg.to}` };
      },
    };
    const first = await sendUpdateCampaign({
      db,
      transporter,
      campaignId: DEFAULT_UPDATE_CAMPAIGN_ID,
      dryRun: false,
      delayMs: 0,
      from: '"Sân Cờ" <test@gmail.com>',
    });
    assert.equal(first.sent, 1);
    assert.equal(first.failed, 1);
    assert.equal(first.skipped, 0);
    assert.deepEqual(delivered, ['alice@gmail.com']);

    // Second run retries ONLY Bob and skips Alice (idempotent).
    failBob = false;
    const second = await sendUpdateCampaign({
      db,
      transporter,
      campaignId: DEFAULT_UPDATE_CAMPAIGN_ID,
      dryRun: false,
      delayMs: 0,
      from: '"Sân Cờ" <test@gmail.com>',
    });
    assert.equal(second.sent, 1);
    assert.equal(second.skipped, 1);
    assert.equal(second.failed, 0);
    assert.deepEqual(delivered, ['alice@gmail.com', 'bob@gmail.com']);

    // Third run sends 0 (everyone already received this campaign).
    const third = await sendUpdateCampaign({
      db,
      transporter,
      campaignId: DEFAULT_UPDATE_CAMPAIGN_ID,
      dryRun: false,
      delayMs: 0,
      from: '"Sân Cờ" <test@gmail.com>',
    });
    assert.equal(third.sent, 0);
    assert.equal(third.skipped, 2);
  } finally {
    await db.close();
  }
});
