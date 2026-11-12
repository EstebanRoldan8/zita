-- ============================================================================
-- 064 — Idempotencia del webhook de WhatsApp (message_id como llave primaria).
--
-- Meta reenvía el mismo mensaje si no recibe 200 a tiempo (o por su cuenta). Antes la deduplicación leía y
-- luego escribía un array (processed_message_ids) y solo marcaba después de enviar la respuesta: dos entregas
-- simultáneas, o en dos réplicas, pasaban las dos.
-- Ahora el webhook hace INSERT del message_id al recibirlo; si ya existe (23505) lo ignora. Es atómico.
--
-- Mientras esta migración no se corra, el backend usa el respaldo anterior (array + memoria).
-- El scheduler borra cada noche las filas de más de 7 días.
-- Solo aditivo e idempotente. Solo la usa el backend con la llave de servicio: RLS activado y SIN políticas.
-- ============================================================================

CREATE TABLE IF NOT EXISTS wa_processed_messages (
  message_id   TEXT PRIMARY KEY,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_processed_messages_received ON wa_processed_messages (received_at);

ALTER TABLE wa_processed_messages ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- VERIFICACIÓN:
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'wa_processed_messages';   -- true
--   SELECT count(*), max(received_at) FROM wa_processed_messages;                  -- crece con cada mensaje
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS wa_processed_messages;
