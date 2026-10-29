-- ============================================================================
-- 061 — Registro de acciones del asistente (confirmar antes de escribir y deshacer).
-- Cada escritura del asistente en un negocio tienda pasa por aquí:
--   pending  → el asistente la propuso y espera el "sí" del usuario
--   applied  → se ejecutó (result guarda antes/después y el id del movimiento de inventario)
--   failed   → se intentó y falló (no se escribió nada)
--   cancelled/expired → el usuario dijo que no o pasó el tiempo
--   undone   → se deshizo (undo_of en la acción inversa apunta a la original)
-- Solo la usa el backend con la llave de servicio: RLS activado y SIN políticas.
-- Solo aditivo e idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS assistant_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  summary      TEXT NOT NULL,
  plan         JSONB NOT NULL DEFAULT '{}'::jsonb,
  result       JSONB,
  undo_of      UUID REFERENCES assistant_actions(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  applied_at   TIMESTAMPTZ,
  undone_at    TIMESTAMPTZ
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assistant_actions_status_check') THEN
    ALTER TABLE assistant_actions ADD CONSTRAINT assistant_actions_status_check
      CHECK (status IN ('pending', 'applied', 'failed', 'cancelled', 'expired', 'undone'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assistant_actions_business ON assistant_actions (business_id, created_at DESC);

ALTER TABLE assistant_actions ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- VERIFICACIÓN:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'assistant_actions';
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'assistant_actions';   -- true
--
-- ROLLBACK (solo si hace falta deshacer; se pierde el historial de acciones del asistente):
-- DROP TABLE IF EXISTS assistant_actions;
