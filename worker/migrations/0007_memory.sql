-- Paul's cross-chat memory (table + indexes).
-- memory_enabled column is in schema.sql / runtime ensure — not ALTERed here.
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_title ON memories(user_id, title);
