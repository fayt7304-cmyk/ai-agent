-- Multi-agent marketplace (0.10.5)
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  mistral_agent_id TEXT NOT NULL,
  avatar_url TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  is_public INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  owner_user_id TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_public ON agents(is_public, is_featured);
CREATE INDEX IF NOT EXISTS idx_agents_slug ON agents(slug);

-- Per-conversation agent (NULL = platform default)
-- Applied via ensureConversationColumns ALTER when missing.
