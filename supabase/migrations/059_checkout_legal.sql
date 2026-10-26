-- 059 — Checkout legal de la tienda: aceptaciones y envío por zona. Solo aditivo e idempotente.
-- Las fechas las pone el servidor (no el cliente). No se guarda IP ni datos extra.
-- Pedidos anteriores: columnas en NULL / false.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS terms_accepted_at      TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS terms_version          TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS data_auth_at           TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS marketing_whatsapp     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS marketing_email        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS marketing_consent_at   TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_zone         TEXT;  -- 'cali' | 'nacional' (se valida en el backend)

-- Rollback (no ejecutar, solo referencia):
-- ALTER TABLE orders
--   DROP COLUMN IF EXISTS terms_accepted_at, DROP COLUMN IF EXISTS terms_version,
--   DROP COLUMN IF EXISTS data_auth_at, DROP COLUMN IF EXISTS marketing_whatsapp,
--   DROP COLUMN IF EXISTS marketing_email, DROP COLUMN IF EXISTS marketing_consent_at,
--   DROP COLUMN IF EXISTS shipping_zone;
