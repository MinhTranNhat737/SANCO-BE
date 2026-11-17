ALTER TABLE practice_games DROP CONSTRAINT IF EXISTS practice_games_kind_check;
ALTER TABLE practice_games ADD CONSTRAINT practice_games_kind_check CHECK (kind IN ('caro','chess','xiangqi','reversi','connect4','go','ludo','monopoly','checkers','tictactoe'));
