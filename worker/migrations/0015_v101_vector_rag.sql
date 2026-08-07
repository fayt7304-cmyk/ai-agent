-- v10.1: vector embeddings for catalog RAG (Workers AI bge → D1 storage)
ALTER TABLE knowledge_docs ADD COLUMN embedding TEXT;
CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge_docs(updated_at DESC);
