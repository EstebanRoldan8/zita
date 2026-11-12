-- ============================================================================
-- 063 — Marca de recordatorio enviado en appointments.
--
-- El cron de recordatorios corre cada 5 min. Antes buscaba citas en [now+120, now+125] min sin ninguna marca:
-- si una corrida se saltaba se perdía el recordatorio y en el borde podía mandarse dos veces.
-- Ahora busca en una ventana más amplia [now+110, now+125] y "reclama" cada cita con
--   UPDATE appointments SET reminder_sent_at = now() WHERE id = ? AND reminder_sent_at IS NULL
-- antes de enviar: nunca se manda dos veces, aunque haya varias instancias.
--
-- Mientras esta migración no se corra, el backend sigue funcionando con el comportamiento anterior
-- (detecta la columna faltante y usa la ventana de 5 minutos sin marca).
-- Solo aditivo e idempotente.
-- ============================================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- Las citas que ya pasaron no necesitan recordatorio: se marcan para que el índice parcial quede pequeño
UPDATE appointments SET reminder_sent_at = scheduled_at
 WHERE reminder_sent_at IS NULL AND scheduled_at < now();

CREATE INDEX IF NOT EXISTS idx_appointments_reminder_pending
  ON appointments (scheduled_at)
  WHERE reminder_sent_at IS NULL AND status IN ('pending', 'confirmed');

NOTIFY pgrst, 'reload schema';

-- VERIFICACIÓN:
--   SELECT column_name FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'reminder_sent_at';
--   SELECT count(*) FROM appointments WHERE reminder_sent_at IS NULL AND scheduled_at > now();  -- citas futuras por recordar
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS idx_appointments_reminder_pending;
--   ALTER TABLE appointments DROP COLUMN IF EXISTS reminder_sent_at;
