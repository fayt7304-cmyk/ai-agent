-- Soft-delete / 7-day grace period before permanent account removal.
ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
