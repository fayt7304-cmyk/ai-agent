-- Migration 0005: Add starred and archived flags to conversations
-- Apply with: wrangler d1 execute mistral-agent-chat-db --file=./migrations/0005_star_archive.sql --remote

ALTER TABLE conversations ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
