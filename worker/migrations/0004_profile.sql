-- Profile fields (display_name, avatar) ship in schema.sql for new installs.
-- No-op migration so `wrangler d1 migrations apply` succeeds on databases
-- that already have these columns.
SELECT 1;
