-- Sân Cờ / PostgreSQL 16+ (also used by the embedded development database).
-- Passwords are scrypt hashes. Session and invitation secrets are SHA-256 digests.
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS players (
  id UUID PRIMARY KEY,
  account_id UUID UNIQUE REFERENCES accounts(id) ON DELETE SET NULL,
  display_name VARCHAR(30) NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 30),
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player_idx ON sessions(player_id);
CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(8) PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES players(id),
  guest_id UUID REFERENCES players(id),
  version INTEGER NOT NULL DEFAULT 0,
  state JSONB NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CHECK (owner_id IS DISTINCT FROM guest_id)
);
CREATE INDEX IF NOT EXISTS rooms_owner_idx ON rooms(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS rooms_guest_idx ON rooms(guest_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS action_receipts (
  room_id VARCHAR(8) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),
  action_id UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (room_id, player_id, action_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY,
  room_id VARCHAR(8) NOT NULL REFERENCES rooms(id),
  owner_id UUID NOT NULL REFERENCES players(id),
  guest_id UUID NOT NULL REFERENCES players(id),
  rules_version VARCHAR(40) NOT NULL,
  snapshot JSONB NOT NULL,
  finished_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_owner_idx ON matches(owner_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS matches_guest_idx ON matches(guest_id, finished_at DESC);
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id),
  room_id VARCHAR(8) REFERENCES rooms(id),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 10 AND 2000),
  created_at BIGINT NOT NULL
);
