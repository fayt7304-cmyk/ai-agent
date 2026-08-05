-- Migration 0007: Paul's cross-chat memory
--
-- `memories` holds durable facts about the user (preferences, profile, topics)
-- that get injected into every new conversation, so Paul remembers what was said
-- in other chats. `users.memory_enabled` is the "Generate memory from chats"
-- switch on the Settings > Memory tab.
--
-- Apply with:
--   cd worker
--   npx wrangler d1 execute mistral-agent-chat-db --file=./migrations/0007_memory.sql --remote

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'chat'
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_user_title ON memories(user_id, title);

-- SQLite has no "ADD COLUMN IF NOT EXISTS": if this line errors with
-- "duplicate column name: memory_enabled", the column already exists — safe to ignore.
ALTER TABLE users ADD COLUMN memory_enabled INTEGER NOT NULL DEFAULT 1;
