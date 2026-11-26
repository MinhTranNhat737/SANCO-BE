-- Track announcement email campaigns so no player receives duplicate copies.
CREATE TABLE IF NOT EXISTS email_campaign_deliveries (
  campaign_id VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL CHECK (email = lower(email)),
  status VARCHAR(16) NOT NULL CHECK (status IN ('sent', 'failed')),
  message_id TEXT,
  error TEXT,
  sent_at BIGINT NOT NULL,
  PRIMARY KEY (campaign_id, email)
);
CREATE INDEX IF NOT EXISTS email_campaign_sent_idx ON email_campaign_deliveries(campaign_id, sent_at DESC);
