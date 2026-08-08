-- Soft edit/delete indexes (edited_at / deleted_at via runtime ensure).
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC);
