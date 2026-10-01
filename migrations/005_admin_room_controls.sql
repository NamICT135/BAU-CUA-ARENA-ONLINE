-- Durable room controls managed by system administrators.

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE,
  DROP CONSTRAINT IF EXISTS room_betting_duration_valid,
  ADD CONSTRAINT room_betting_duration_valid
    CHECK (betting_duration IN (15, 30, 45, 60));

CREATE INDEX IF NOT EXISTS idx_rooms_active_locked
  ON rooms(status, locked)
  WHERE status IN ('active', 'paused');
