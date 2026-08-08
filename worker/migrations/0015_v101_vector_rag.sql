-- Vector RAG index. embedding column added at runtime if missing.
CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge_docs(updated_at DESC);
