-- ============================================================================
-- 065 — Registro del uso real de IA (tokens y costo) por llamada a Claude.
--
-- Una fila por messages.create del bot de WhatsApp, del asistente, del agente de tienda y del test del sistema.
-- Sin PII: conversation_key es un hash (sha256, 16 hex) de negocio + teléfono; nunca el teléfono ni el texto.
-- request_id agrupa las llamadas de un mismo mensaje (loop de tools); iteration 0 = primera llamada.
-- cost_usd se calcula con los precios de Haiku 4.5 (USD por millón): input 1, output 5, escritura de caché 1.25,
-- lectura de caché 0.10.
--
-- Solo aditivo e idempotente. Solo la usa el backend con la llave de servicio: RLS activado y SIN políticas.
-- Si esta migración no se ha corrido, el backend sigue funcionando (el insert falla en silencio con un warn).
-- ============================================================================

CREATE TABLE IF NOT EXISTS ai_usage (
  id                 BIGSERIAL PRIMARY KEY,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  business_id        UUID REFERENCES businesses(id) ON DELETE CASCADE,
  flow               TEXT NOT NULL,
  conversation_key   TEXT,
  request_id         UUID,
  iteration          SMALLINT,
  model              TEXT NOT NULL,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  stop_reason        TEXT,
  latency_ms         INTEGER,
  cost_usd           NUMERIC(12, 8)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_flow_check') THEN
    ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_flow_check
      CHECK (flow IN ('whatsapp_bot', 'assistant', 'store_agent', 'system_test'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_usage_biz_day ON ai_usage (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_request ON ai_usage (request_id);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- Resumen diario por negocio y flujo (hora de Colombia)
CREATE OR REPLACE VIEW ai_usage_daily AS
SELECT business_id,
       flow,
       date_trunc('day', created_at AT TIME ZONE 'America/Bogota') AS dia,
       count(*)                       AS llamadas,
       count(DISTINCT request_id)     AS mensajes,
       sum(input_tokens)              AS input,
       sum(output_tokens)             AS output,
       sum(cache_write_tokens)        AS cache_write,
       sum(cache_read_tokens)         AS cache_read,
       round(sum(cost_usd)::numeric, 4) AS costo_usd,
       round(100.0 * sum(cache_read_tokens) / nullif(sum(cache_read_tokens + cache_write_tokens + input_tokens), 0), 1) AS pct_cache_hit
  FROM ai_usage
 GROUP BY 1, 2, 3;

-- La vista no debe quedar expuesta por la API pública (solo service role)
REVOKE ALL ON ai_usage_daily FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- CONSULTAS ÚTILES:
--   Costo por mensaje (todas las llamadas del loop):
--     SELECT request_id, flow, count(*) AS llamadas, sum(cost_usd) AS usd FROM ai_usage
--      WHERE created_at > now() - interval '1 day' GROUP BY 1, 2 ORDER BY usd DESC LIMIT 20;
--   Costo por conversación del bot (últimos 7 días):
--     SELECT conversation_key, count(DISTINCT request_id) AS mensajes, sum(cost_usd) AS usd FROM ai_usage
--      WHERE flow = 'whatsapp_bot' AND created_at > now() - interval '7 days' GROUP BY 1 ORDER BY usd DESC;
--   Top negocios del mes:
--     SELECT business_id, flow, sum(cost_usd) AS usd FROM ai_usage
--      WHERE created_at >= date_trunc('month', now()) GROUP BY 1, 2 ORDER BY usd DESC LIMIT 10;
--   ¿El caché funciona? (debería estar > 70 %):
--     SELECT flow, dia, pct_cache_hit FROM ai_usage_daily ORDER BY dia DESC LIMIT 20;
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS ai_usage_daily;
--   DROP TABLE IF EXISTS ai_usage;
