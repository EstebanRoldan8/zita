ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS min_stock INT DEFAULT 2;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_sku
  ON products (business_id, sku) WHERE sku IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_variants_business_sku
  ON product_variants (business_id, sku) WHERE sku IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id      UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  type            TEXT NOT NULL CHECK (type IN ('inicial','entrada','venta','ajuste','devolucion','merma')),
  quantity_change INT  NOT NULL,
  stock_after     INT  NOT NULL,
  reason          TEXT,
  reference_type  TEXT,
  reference_id    UUID,
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invmov_product ON inventory_movements (business_id, product_id, created_at DESC);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_inventory_movements_read ON inventory_movements
  FOR SELECT USING (business_id = get_business_id_for_user(auth.uid()));

CREATE POLICY superadmin_inventory_movements_all ON inventory_movements
  FOR ALL USING (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE OR REPLACE FUNCTION adjust_stock(
  p_business_id UUID, p_product_id UUID, p_variant_id UUID,
  p_change INT, p_type TEXT, p_reason TEXT DEFAULT NULL,
  p_ref_type TEXT DEFAULT NULL, p_ref_id UUID DEFAULT NULL, p_user UUID DEFAULT NULL
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new INT;
BEGIN
  IF p_variant_id IS NOT NULL THEN
    UPDATE product_variants
       SET stock = stock + p_change, updated_at = now()
     WHERE id = p_variant_id AND product_id = p_product_id
       AND business_id = p_business_id AND stock + p_change >= 0
    RETURNING stock INTO v_new;
  ELSE
    UPDATE products
       SET stock = stock + p_change, updated_at = now()
     WHERE id = p_product_id AND business_id = p_business_id
       AND stock + p_change >= 0
    RETURNING stock INTO v_new;
  END IF;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'STOCK_INSUFICIENTE_O_NO_ENCONTRADO';
  END IF;

  IF p_variant_id IS NOT NULL THEN
    UPDATE products
       SET stock = (SELECT COALESCE(SUM(stock),0) FROM product_variants
                     WHERE product_id = p_product_id AND is_active),
           updated_at = now()
     WHERE id = p_product_id;
  END IF;

  INSERT INTO inventory_movements
    (business_id, product_id, variant_id, type, quantity_change, stock_after,
     reason, reference_type, reference_id, created_by)
  VALUES
    (p_business_id, p_product_id, p_variant_id, p_type, p_change, v_new,
     p_reason, p_ref_type, p_ref_id, p_user);

  RETURN v_new;
END $$;

REVOKE ALL ON FUNCTION adjust_stock(UUID,UUID,UUID,INT,TEXT,TEXT,TEXT,UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION adjust_stock(UUID,UUID,UUID,INT,TEXT,TEXT,TEXT,UUID,UUID) TO service_role;

INSERT INTO inventory_movements
  (business_id, product_id, variant_id, type, quantity_change, stock_after, reason, reference_type)
SELECT business_id, id, NULL, 'inicial', stock, stock, 'Saldo inicial', 'manual'
  FROM products WHERE COALESCE(has_variants,false) = false AND stock > 0;

INSERT INTO inventory_movements
  (business_id, product_id, variant_id, type, quantity_change, stock_after, reason, reference_type)
SELECT business_id, product_id, id, 'inicial', stock, stock, 'Saldo inicial', 'manual'
  FROM product_variants WHERE stock > 0;
