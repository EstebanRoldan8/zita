-- ============================================================================
-- 058 — Género del producto (mujer / hombre / unisex). Solo aditivo e idempotente.
-- La tienda deja de derivar Mujer/Hombre de la categoría y lee products.gender.
-- Los productos existentes quedan en 'mujer'; el backfill fino se corre aparte (script con backup).
-- ============================================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS gender TEXT NOT NULL DEFAULT 'mujer';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_gender_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_gender_check CHECK (gender IN ('mujer', 'hombre', 'unisex'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFICACIÓN:
-- SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
--  WHERE table_name = 'products' AND column_name = 'gender';   -- 1 fila: text, 'mujer', NO
--
-- ROLLBACK (solo si hace falta deshacer):
-- ALTER TABLE products DROP CONSTRAINT IF EXISTS products_gender_check;
-- ALTER TABLE products DROP COLUMN IF EXISTS gender;
