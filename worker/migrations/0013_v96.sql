-- Read receipts, audit, knowledge docs (last_seen_at via runtime ensure).
CREATE TABLE IF NOT EXISTS conversation_reads (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  last_message_id TEXT,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE IF NOT EXISTS collab_audit (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_username TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collab_audit_conv ON collab_audit(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_knowledge_title ON knowledge_docs(title);
