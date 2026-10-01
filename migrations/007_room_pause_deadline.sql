ALTER TABLE rooms ADD COLUMN paused_at TIMESTAMPTZ;
UPDATE rooms SET paused_at=CURRENT_TIMESTAMP WHERE status='paused';
