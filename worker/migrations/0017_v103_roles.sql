-- v10.3 admin staff roles
CREATE TABLE IF NOT EXISTS admin_staff (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL, -- owner | moderator | catalog
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_staff_role ON admin_staff(role);
