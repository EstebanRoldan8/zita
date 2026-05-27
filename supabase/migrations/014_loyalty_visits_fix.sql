-- ============================================================
-- ZITA — Separar contadores de visitas (reiniciable vs real)
-- ============================================================

-- loyalty_visits: se reinicia al canjear (para la barra de progreso)
-- total_visits: refleja visitas reales totales (nunca se reinicia)
ALTER TABLE client_loyalty
  ADD COLUMN IF NOT EXISTS loyalty_visits integer NOT NULL DEFAULT 0 CHECK (loyalty_visits >= 0);
