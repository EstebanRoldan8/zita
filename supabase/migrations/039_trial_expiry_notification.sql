-- ============================================================
-- ZITA — Notificación al dueño cuando el plan/trial expiró
-- ============================================================

ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS last_trial_expiry_notification TIMESTAMPTZ;
