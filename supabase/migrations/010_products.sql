-- ============================================================
-- ZITA — Productos e inventario
-- ============================================================

-- products ya existe; solo agregamos las columnas nuevas
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS min_stock   integer     DEFAULT 5,
  ADD COLUMN IF NOT EXISTS category    text,
  ADD COLUMN IF NOT EXISTS is_active   boolean     DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now();

-- ============================================================
-- product_sales
-- ============================================================

CREATE TABLE IF NOT EXISTS product_sales (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid        NOT NULL REFERENCES businesses(id)  ON DELETE CASCADE,
  product_id     uuid        NOT NULL REFERENCES products(id)    ON DELETE CASCADE,
  quantity       integer     NOT NULL,
  total_amount   numeric     NOT NULL,
  client_id      uuid        REFERENCES clients(id)              ON DELETE SET NULL,
  appointment_id uuid        REFERENCES appointments(id)         ON DELETE SET NULL,
  sold_via       text        DEFAULT 'presencial' CHECK (sold_via IN ('presencial', 'whatsapp')),
  created_at     timestamptz DEFAULT now()
);

-- ============================================================
-- RLS — product_sales
-- ============================================================

ALTER TABLE product_sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmin_product_sales_all" ON product_sales;
CREATE POLICY "superadmin_product_sales_all" ON product_sales
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

DROP POLICY IF EXISTS "owner_product_sales_own" ON product_sales;
CREATE POLICY "owner_product_sales_own" ON product_sales
  FOR ALL
  USING (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- RLS — products
-- ============================================================

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmin_products_all" ON products;
CREATE POLICY "superadmin_products_all" ON products
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

DROP POLICY IF EXISTS "owner_products_own" ON products;
CREATE POLICY "owner_products_own" ON products
  FOR ALL
  USING (business_id = get_business_id_for_user(auth.uid()));

  