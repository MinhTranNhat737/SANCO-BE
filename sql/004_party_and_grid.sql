ALTER TABLE practice_games DROP CONSTRAINT IF EXISTS practice_games_kind_check;
ALTER TABLE practice_games ADD CONSTRAINT practice_games_kind_check CHECK (kind IN ('caro','chess','xiangqi','reversi','connect4','go','ludo','monopoly','checkers','tictactoe'));
CREATE TABLE IF NOT EXISTS room_members (
  room_id VARCHAR(8) NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),
  PRIMARY KEY(room_id,player_id)
);
CREATE INDEX IF NOT EXISTS room_members_player_idx ON room_members(player_id,room_id);
CREATE TABLE IF NOT EXISTS match_members (
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),
  PRIMARY KEY(match_id,player_id)
);
CREATE INDEX IF NOT EXISTS match_members_player_idx ON match_members(player_id,match_id);
