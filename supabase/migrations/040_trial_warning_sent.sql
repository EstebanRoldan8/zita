-- ============================================================
-- ZITA — Aviso de trial por vencer (3 días antes), evita reenvíos
-- ============================================================

ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS trial_warning_sent_at TIMESTAMPTZ;
