-- ============================================================
-- ZITA — Product Variants
-- ============================================================

-- Agregar columnas a tabla products
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS has_variants boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS image_url text;

-- ============================================================
-- product_variants
-- ============================================================

CREATE TABLE IF NOT EXISTS product_variants (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid        NOT NULL REFERENCES products(id)     ON DELETE CASCADE,
  business_id   uuid        NOT NULL REFERENCES businesses(id)   ON DELETE CASCADE,
  attributes    jsonb       NOT NULL DEFAULT '{}',
  stock         integer     NOT NULL DEFAULT 0 CHECK (stock >= 0),
  is_active     boolean     DEFAULT true NOT NULL,
  created_at    timestamptz DEFAULT now()
);

-- ============================================================
-- Índices
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_product_variants_product_id
  ON product_variants(product_id);

CREATE INDEX IF NOT EXISTS idx_product_variants_business_id
  ON product_variants(business_id);

CREATE INDEX IF NOT EXISTS idx_product_variants_attributes
  ON product_variants USING gin(attributes);

-- ============================================================
-- RLS — product_variants
-- ============================================================

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmin_product_variants_all" ON product_variants;
CREATE POLICY "superadmin_product_variants_all" ON product_variants
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

DROP POLICY IF EXISTS "owner_product_variants_own" ON product_variants;
CREATE POLICY "owner_product_variants_own" ON product_variants
  FOR ALL
  USING (business_id = get_business_id_for_user(auth.uid()));

-- Ejecutado: 2026-05-19

