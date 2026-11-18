ALTER TABLE player_ratings ADD COLUMN pool VARCHAR(12) NOT NULL DEFAULT 'overall';
ALTER TABLE player_ratings DROP CONSTRAINT player_ratings_pkey;
ALTER TABLE player_ratings ADD PRIMARY KEY (player_id, kind, pool);
DROP INDEX IF EXISTS ratings_leaderboard_idx;
CREATE INDEX ratings_leaderboard_idx ON player_ratings(kind, pool, elo DESC, games DESC, player_id);

CREATE TABLE rank_queue_lock (id INTEGER PRIMARY KEY);
INSERT INTO rank_queue_lock (id) VALUES (1);
CREATE TABLE rank_queue (
  player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL,
  preset VARCHAR(10) NOT NULL,
  joined_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  room_id VARCHAR(8) REFERENCES rooms(id) ON DELETE CASCADE
);
CREATE INDEX rank_queue_seek_idx ON rank_queue (kind, preset, expires_at) WHERE room_id IS NULL;
