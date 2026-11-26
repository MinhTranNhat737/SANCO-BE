ALTER TABLE accounts ADD COLUMN username VARCHAR(30) UNIQUE;
ALTER TABLE accounts ADD CONSTRAINT accounts_username_format CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9_.-]{2,29}$');
