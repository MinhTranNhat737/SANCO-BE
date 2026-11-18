CREATE TABLE IF NOT EXISTS player_ratings (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL,
  elo INTEGER NOT NULL DEFAULT 1000 CHECK (elo >= 100),
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  peak INTEGER NOT NULL DEFAULT 1000,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (player_id, kind)
);
CREATE INDEX IF NOT EXISTS ratings_leaderboard_idx ON player_ratings(kind, elo DESC, games DESC);
CREATE TABLE IF NOT EXISTS rating_settlements (
  game_id UUID PRIMARY KEY,
  kind VARCHAR(16) NOT NULL,
  source VARCHAR(12) NOT NULL,
  changes JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS practice_ranked_active_idx ON practice_games(player_id, kind) WHERE state->>'ranked'='true' AND state->>'phase'='playing';
