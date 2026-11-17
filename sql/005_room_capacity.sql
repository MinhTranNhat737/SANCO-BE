CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS rooms_waiting_owner_idx ON rooms(owner_id) WHERE state->'game'->>'phase'='waiting';
CREATE INDEX IF NOT EXISTS rooms_playing_idx ON rooms(id) WHERE state->'game'->>'phase'='playing';
CREATE INDEX IF NOT EXISTS practice_bot_pending_idx ON practice_games(id) WHERE state->>'phase'='playing' AND state->>'turn'<>state->>'humanSide';
