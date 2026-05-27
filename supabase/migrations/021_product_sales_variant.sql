-- ============================================================
-- ZITA — Product Sales variant support
-- ============================================================

-- Agregar columna variant_id a product_sales
ALTER TABLE product_sales
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL;

-- Crear índice para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_product_sales_variant_id
  ON product_sales(variant_id);

-- Ejecutado: 2026-05-19
