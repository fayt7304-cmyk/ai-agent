-- Migration 0006: Add a visibility flag for conversation sharing
-- 'private' = only the owner can open it (default)
-- 'shared'  = any signed-in user of this app can open it via the share link
-- Apply with: wrangler d1 execute mistral-agent-chat-db --file=./migrations/0006_conversation_visibility.sql --remote

ALTER TABLE conversations ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
