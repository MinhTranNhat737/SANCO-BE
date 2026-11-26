import nodemailer from 'nodemailer';
import { GameError } from './game.js';

export const DEFAULT_UPDATE_CAMPAIGN_ID = 'sanco-update-2026-11-monopoly-commander';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return EMAIL_RE.test(normalized) ? normalized : null;
}

export function buildUpdateEmail({
  playerName = 'Bạn cờ',
  siteUrl = process.env.FRONTEND_SITE_URL || 'https://www.sanco.games',
} = {}) {
  const cleanUrl = String(siteUrl || 'https://www.sanco.games').replace(/\/+$/, '');
  const monopolyUrl = `${cleanUrl}/?game=monopoly`;
  const commanderUrl = `${cleanUrl}/?game=commander`;
  const safeName = escapeHtml(playerName || 'Bạn cờ');
  const subject = '[Sân Cờ] Bản cập nhật mới: Cờ Tỷ Phú 17×9 & Cờ Tư Lệnh phóng to quân cờ';

  const text = [
    `Chào ${playerName || 'Bạn cờ'},`,
    '',
    'Sân Cờ vừa ra mắt bản cập nhật lớn cho Cờ Tỷ Phú Việt Nam và Cờ Tư Lệnh:',
    '',
    '1. CỜ TỶ PHÚ VIỆT NAM',
    '- Bàn chữ nhật 17×9 tràn màn hình lớn tối đa, dễ nhìn hơn hẳn trên cả 2D và 3D.',
    '- 4 ô góc vuông to nhất bàn: Xuất phát (+500 tr), Nghỉ chân (+100 tr), Thăm tù và Vào tù.',
    '- Khung đấu giá gọn giữa bàn, lược bỏ nút dư thừa giúp mua / bỏ qua mượt hơn.',
    '- 5 cấp nhà 2D/3D (C1 đến Khách sạn ★KS), nhãn tên ô đất hiện bên cạnh khi quân đứng lên không che ô, kèm âm thanh va bàn gỗ.',
    `=> Vào chơi ngay: ${monopolyUrl}`,
    '',
    '2. CỜ TƯ LỆNH (2D & 3D)',
    '- Phóng to rõ nét toàn bộ quân cờ 2D và mô hình 3D.',
    '- Xóa phần chữ ký hiệu dưới chân từng quân giúp mặt bàn chiến trường thoáng và trực quan hơn.',
    `=> Vào chơi ngay: ${commanderUrl}`,
    '',
    `Trải nghiệm tất cả 16 môn cờ miễn phí tại: ${cleanUrl}`,
    '',
    'Chúc bạn có những ván cờ thật vui,',
    'Đội ngũ Sân Cờ (sanco.games)',
  ].join('\n');

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#111713;font-family:'Segoe UI',Arial,sans-serif;color:#f3ead7;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#111713;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#1a221c;border:1px solid #3c4d3e;border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:26px 28px 20px;background:linear-gradient(135deg,#253327,#171f19);border-bottom:2px solid #d4a84f;">
              <div style="font-size:12px;letter-spacing:2px;font-weight:700;color:#e7c572;text-transform:uppercase;">SÂN CỜ · BẢN CẬP NHẬT MỚI</div>
              <h1 style="margin:8px 0 6px;font-size:24px;line-height:1.3;color:#fff7e4;">Nâng cấp lớn cho Cờ Tỷ Phú &amp; Cờ Tư Lệnh</h1>
              <p style="margin:0;font-size:14px;color:#c7d3c4;">Chào <strong>${safeName}</strong>, Sân Cờ vừa cập nhật giao diện &amp; luật chơi mới cực mượt, mời bạn vào bàn trải nghiệm ngay!</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#212c24;border:1px solid #3b4e3f;border-radius:10px;margin-bottom:18px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font-size:13px;font-weight:800;color:#f2cb6c;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px;">🏛️ Cờ Tỷ Phú Việt Nam</div>
                    <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.65;color:#ece4d1;">
                      <li><strong>Bàn chữ nhật 17×9 tràn màn hình</strong>: kích thước ô lớn tối đa, nhìn rõ từng tỉnh thành trên cả 2D và 3D.</li>
                      <li><strong>4 góc vuông to nhất bàn</strong>: khóa chuẩn <strong>Xuất phát (+500 tr)</strong>, <strong>Nghỉ chân (+100 tr)</strong>, <strong>Thăm tù</strong> và <strong>Vào tù</strong>.</li>
                      <li><strong>Đấu giá &amp; mua đất gọn gàng</strong>: khung đấu giá hiện giữa bàn, lược bỏ nút dư thừa để ra quyết định nhanh hơn.</li>
                      <li><strong>5 cấp nhà 2D/3D &amp; âm thanh bàn gỗ</strong>: phân biệt rõ C1–Khách sạn ★KS, kèm thẻ tên ô đất trồi ra bên cạnh không che mặt bàn.</li>
                    </ul>
                    <div style="margin-top:14px;">
                      <a href="${escapeHtml(monopolyUrl)}" style="display:inline-block;padding:10px 18px;background:#e1b44c;color:#171d18;font-weight:800;font-size:13px;text-decoration:none;border-radius:8px;">Chơi Cờ Tỷ Phú ngay →</a>
                    </div>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#212c24;border:1px solid #3b4e3f;border-radius:10px;margin-bottom:22px;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font-size:13px;font-weight:800;color:#8bd3f5;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:8px;">⭐ Cờ Tư Lệnh (2D &amp; 3D)</div>
                    <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.65;color:#ece4d1;">
                      <li><strong>Phóng to quân cờ</strong> trên cả bàn 2D và mô hình 3D Việt Nam, căn giữa trọn đế quân.</li>
                      <li><strong>Xóa nhãn chữ dưới từng quân</strong> giúp mặt bàn chiến trường thoáng, sạch và quan sát thế trận nhanh hơn.</li>
                    </ul>
                    <div style="margin-top:14px;">
                      <a href="${escapeHtml(commanderUrl)}" style="display:inline-block;padding:10px 18px;background:#2f74a8;color:#fff7e4;font-weight:800;font-size:13px;text-decoration:none;border-radius:8px;">Chơi Cờ Tư Lệnh ngay →</a>
                    </div>
                  </td>
                </tr>
              </table>

              <div style="text-align:center;padding-top:4px;">
                <a href="${escapeHtml(cleanUrl)}" style="display:inline-block;padding:12px 26px;background:linear-gradient(180deg,#f0c969,#cfa03c);color:#171c16;font-weight:900;font-size:15px;text-decoration:none;border-radius:10px;">Mở Sân Cờ (sanco.games)</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px;border-top:1px solid #2e3d31;font-size:12px;line-height:1.6;color:#93a594;text-align:center;">
              Email này được gửi tới thành viên đã đăng ký tài khoản tại <a href="${escapeHtml(cleanUrl)}" style="color:#d9bc75;text-decoration:none;">sanco.games</a>.<br/>
              Nếu bạn không muốn nhận tin cập nhật trong tương lai, chỉ cần phản hồi lại email này với nội dung <em>"Hủy nhận tin"</em>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

export function gmailConfigStatus(env = process.env) {
  const user = (env.GMAIL_USER || '').trim();
  const pass = (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const fromName = (env.GMAIL_FROM_NAME || 'Sân Cờ').trim() || 'Sân Cờ';
  return {
    configured: Boolean(normalizeEmail(user) && pass.length >= 8),
    user: normalizeEmail(user) || null,
    from: normalizeEmail(user) ? `"${fromName.replaceAll('"', '')}" <${normalizeEmail(user)}>` : null,
  };
}

export function createGmailTransporter(env = process.env) {
  const cfg = gmailConfigStatus(env);
  if (!cfg.configured) {
    throw new GameError(
      'Chưa cấu hình Gmail SMTP. Hãy đặt GMAIL_USER và GMAIL_APP_PASSWORD (App Password 16 ký tự từ Google Account) trong biến môi trường.',
      400,
    );
  }
  const pass = (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: cfg.user, pass },
  });
}

export async function listPlayerEmailRecipients(db) {
  const { rows } = await db.query(`
    SELECT lower(src.email) AS email,
           COALESCE(NULLIF(trim(max(p.display_name)), ''), 'Bạn cờ') AS display_name
    FROM (
      SELECT id AS account_id, email FROM accounts WHERE email IS NOT NULL AND trim(email) <> ''
      UNION ALL
      SELECT account_id, email FROM oauth_identities WHERE email IS NOT NULL AND trim(email) <> ''
    ) src
    LEFT JOIN players p ON p.account_id = src.account_id
    WHERE p.suspended_at IS NULL
    GROUP BY lower(src.email)
    ORDER BY lower(src.email) ASC
  `);
  const seen = new Set();
  const recipients = [];
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push({ email, displayName: row.display_name || 'Bạn cờ' });
  }
  return recipients;
}

export async function listAlreadySentEmails(db, campaignId) {
  const { rows } = await db.query(
    "SELECT email FROM email_campaign_deliveries WHERE campaign_id=$1 AND status='sent'",
    [campaignId],
  );
  return new Set(rows.map(r => r.email));
}

export async function sendUpdateCampaign({
  db,
  transporter,
  campaignId = DEFAULT_UPDATE_CAMPAIGN_ID,
  recipients,
  dryRun = false,
  delayMs = 1200,
  from,
  siteUrl = process.env.FRONTEND_SITE_URL || 'https://www.sanco.games',
  limit,
} = {}) {
  const targetList = recipients ?? (await listPlayerEmailRecipients(db));
  const alreadySent = db ? await listAlreadySentEmails(db, campaignId) : new Set();

  const pending = [];
  let skipped = 0;
  for (const item of targetList) {
    const email = normalizeEmail(typeof item === 'string' ? item : item.email);
    if (!email) { skipped++; continue; }
    if (alreadySent.has(email)) { skipped++; continue; }
    pending.push({
      email,
      displayName: typeof item === 'string' ? 'Bạn cờ' : (item.displayName || 'Bạn cờ'),
    });
  }

  const batch = Number.isInteger(limit) && limit > 0 ? pending.slice(0, limit) : pending;
  const sample = buildUpdateEmail({ playerName: batch[0]?.displayName || 'Bạn cờ', siteUrl });

  if (dryRun) {
    return {
      campaignId,
      dryRun: true,
      total: targetList.length,
      pending: batch.length,
      sent: 0,
      skipped,
      failed: 0,
      failures: [],
      subject: sample.subject,
    };
  }

  if (!transporter) {
    throw new GameError('Thiếu Gmail transporter để gửi email.', 500);
  }
  const sender = from || gmailConfigStatus().from;
  if (!sender) {
    throw new GameError('Thiếu địa chỉ người gửi (GMAIL_USER).', 400);
  }

  let sent = 0;
  let failed = 0;
  const failures = [];

  for (let i = 0; i < batch.length; i++) {
    const recipient = batch[i];
    const message = buildUpdateEmail({ playerName: recipient.displayName, siteUrl });
    try {
      const info = await transporter.sendMail({
        from: sender,
        to: recipient.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      sent++;
      if (db) {
        await db.query(
          `INSERT INTO email_campaign_deliveries(campaign_id, email, status, message_id, error, sent_at)
           VALUES($1, $2, 'sent', $3, NULL, $4)
           ON CONFLICT (campaign_id, email)
           DO UPDATE SET status='sent', message_id=EXCLUDED.message_id, error=NULL, sent_at=EXCLUDED.sent_at`,
          [campaignId, recipient.email, info?.messageId || null, Date.now()],
        );
      }
    } catch (error) {
      failed++;
      const reason = error?.message || String(error);
      failures.push({ email: recipient.email, error: reason });
      if (db) {
        await db.query(
          `INSERT INTO email_campaign_deliveries(campaign_id, email, status, message_id, error, sent_at)
           VALUES($1, $2, 'failed', NULL, $3, $4)
           ON CONFLICT (campaign_id, email)
           DO UPDATE SET status='failed', error=EXCLUDED.error, sent_at=EXCLUDED.sent_at`,
          [campaignId, recipient.email, reason.slice(0, 500), Date.now()],
        );
      }
    }
    if (delayMs > 0 && i + 1 < batch.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return {
    campaignId,
    dryRun: false,
    total: targetList.length,
    pending: batch.length,
    sent,
    skipped,
    failed,
    failures,
    subject: sample.subject,
  };
}
