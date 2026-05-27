-- ============================================================
-- ZITA — Registro de canjes de recompensas de fidelización
-- ============================================================

ALTER TABLE client_loyalty
  ADD COLUMN IF NOT EXISTS last_redeemed_at timestamptz;
