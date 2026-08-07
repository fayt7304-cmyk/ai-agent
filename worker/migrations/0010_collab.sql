-- Collaboration: sender on messages, invite codes, membership, lock after third-party post
ALTER TABLE messages ADD COLUMN sender_user_id TEXT;
ALTER TABLE conversations ADD COLUMN collab_code TEXT;
ALTER TABLE conversations ADD COLUMN collab_code_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN collab_locked INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON conversation_members(user_id);
