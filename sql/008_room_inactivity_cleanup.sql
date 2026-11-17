-- Allow deleting inactive rooms even after completed matches or reports reference them.
ALTER TABLE matches ALTER COLUMN room_id DROP NOT NULL;
ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_room_id_fkey;
ALTER TABLE matches ADD CONSTRAINT matches_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;

ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_room_id_fkey;
ALTER TABLE reports ADD CONSTRAINT reports_room_id_fkey FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rooms_updated_idx ON rooms(updated_at);
CREATE INDEX IF NOT EXISTS practice_updated_idx ON practice_games(updated_at);
