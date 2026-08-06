-- Store User-Agent on sessions for the Account → Active sessions table.
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
