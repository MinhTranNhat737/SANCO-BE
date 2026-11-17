-- Bot practice is independent of private human-versus-human rooms.
CREATE TABLE IF NOT EXISTS practice_games (
  id UUID PRIMARY KEY,
  player_id UUID NOT NULL REFERENCES players(id),
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('caro', 'chess', 'xiangqi')),
  state JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS practice_player_idx ON practice_games(player_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS practice_receipts (
  game_id UUID NOT NULL REFERENCES practice_games(id) ON DELETE CASCADE,
  action_id UUID NOT NULL,
  request_hash CHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(game_id, action_id)
);
