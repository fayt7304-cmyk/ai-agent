-- Lets people set a display name and profile picture from Settings → Profile.
-- avatar stores a small data: URL (resized/compressed client-side before upload).
ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN avatar TEXT;
