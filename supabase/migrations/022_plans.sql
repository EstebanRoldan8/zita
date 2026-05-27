-- ============================================================
-- ZITA — Plan management and AI message limits
-- ============================================================

ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'estandar',
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '30 days'),
ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ai_messages_today INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_messages_date DATE DEFAULT CURRENT_DATE;

UPDATE businesses
SET
  plan = 'estandar',
  trial_ends_at = now() + interval '30 days'
WHERE owner_email = 'barberia@test.com';
