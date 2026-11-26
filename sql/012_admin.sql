ALTER TABLE players ADD COLUMN is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE players ADD COLUMN suspended_at BIGINT;
ALTER TABLE players ADD COLUMN suspension_reason VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','dismissed'));
ALTER TABLE reports ADD COLUMN admin_note VARCHAR(2000) NOT NULL DEFAULT '';
ALTER TABLE reports ADD COLUMN updated_at BIGINT;
CREATE INDEX reports_status_created_idx ON reports(status, created_at DESC);
CREATE TABLE site_settings (
  id INTEGER PRIMARY KEY CHECK (id=1),
  announcement VARCHAR(1000) NOT NULL DEFAULT '',
  registration_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  rooms_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at BIGINT NOT NULL
);
INSERT INTO site_settings(id,updated_at) VALUES(1,0);
CREATE TABLE admin_audit (
  id UUID PRIMARY KEY,
  actor_id UUID REFERENCES players(id),
  action VARCHAR(64) NOT NULL,
  target TEXT NOT NULL,
  details JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX admin_audit_created_idx ON admin_audit(created_at DESC);
