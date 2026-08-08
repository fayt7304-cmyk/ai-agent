-- Friends + DM chats
-- dm_peer_id is added by schema / ensureConversationColumns — not ALTERed here.
CREATE TABLE IF NOT EXISTS friendships (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_a, user_b)
);
CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(user_a, status);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b, status);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id);
CREATE INDEX IF NOT EXISTS idx_conversations_dm_peer ON conversations(dm_peer_id);
