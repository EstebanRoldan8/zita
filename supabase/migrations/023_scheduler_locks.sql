CREATE TABLE IF NOT EXISTS scheduler_locks (
  lock_key TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduler_locks_expires_at ON scheduler_locks(expires_at);
