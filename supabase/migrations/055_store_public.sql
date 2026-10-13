-- ============================================================================
-- 055 — Tienda pública (API /api/store/:slug). Solo aditivo e idempotente.
-- ============================================================================

-- businesses: identificador público y configuración de la tienda
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS store_enabled BOOLEAN NOT NULL DEFAULT false;
-- store_settings: whatsapp_number, shipping_flat_cost, free_shipping_from, payment_methods (texto),
-- currency ('COP'), tagline, hero_title, hero_subtitle, policies {envios, cambios, privacidad},
-- social {instagram, tiktok}, logo_url
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS store_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- slug único sin distinguir mayúsculas (solo cuando está definido)
CREATE UNIQUE INDEX IF NOT EXISTS uq_businesses_slug ON businesses (lower(slug)) WHERE slug IS NOT NULL;

-- orders: lo que faltaba para pedidos web (verificado contra 050 y 052).
-- Ya existían: source (default 'manual'; los pedidos web usan 'web'), customer_email,
-- delivery_address (se usa como dirección de envío).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_city   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost   NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_business_idempotency
  ON orders (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICACIÓN (correr una por una: el SQL Editor solo muestra el último resultado)
-- ============================================================================
-- 1) Columnas nuevas de businesses (3 filas)
-- SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
--  WHERE table_name = 'businesses' AND column_name IN ('slug','store_enabled','store_settings');
--
-- 2) Columnas nuevas de orders (3 filas)
-- SELECT column_name, data_type, column_default FROM information_schema.columns
--  WHERE table_name = 'orders' AND column_name IN ('shipping_city','shipping_cost','idempotency_key');
--
-- 3) Índices únicos (2 filas)
-- SELECT indexname, indexdef FROM pg_indexes
--  WHERE indexname IN ('uq_businesses_slug','uq_orders_business_idempotency');
--
-- 4) Ningún negocio quedó con tienda activa por defecto (debe dar 0)
-- SELECT count(*) FROM businesses WHERE store_enabled = true;
--
-- 5) Para activar la tienda de un negocio (ejemplo, ajustar valores):
-- UPDATE businesses
--    SET slug = 'flow', store_enabled = true,
--        store_settings = '{"whatsapp_number":"573000000000","shipping_flat_cost":12000,
--          "free_shipping_from":200000,"payment_methods":"Transferencia, Nequi o contraentrega",
--          "currency":"COP"}'::jsonb
--  WHERE id = '<business_id>';
