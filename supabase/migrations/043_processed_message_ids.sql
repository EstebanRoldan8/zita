-- ============================================================
-- Agregar columna processed_message_ids para deduplicación
-- de webhooks Meta reintentados
-- ============================================================

-- Agregar columna de array de text para guardar los últimos 50 message_ids procesados
ALTER TABLE whatsapp_conversations
ADD COLUMN processed_message_ids text[] DEFAULT ARRAY[]::text[];

-- Índice para búsquedas rápidas (aunque PostgreSQL puede ser lento con @> en arrays grandes,
-- para 50 elementos es aceptable)
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_processed_message_ids
ON whatsapp_conversations USING GIN (processed_message_ids);
