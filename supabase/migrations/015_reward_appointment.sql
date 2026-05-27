-- ============================================================
-- ZITA — Citas de recompensa
-- ============================================================

-- is_reward marca una cita como canje de recompensa
-- Si es true: solo incrementa total_visits (no loyalty_visits)
-- Si es false: incrementa ambos total_visits y loyalty_visits
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS is_reward boolean DEFAULT false;
