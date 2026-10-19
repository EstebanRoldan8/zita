-- ============================================================================
-- 056 — Sets / combos (productos compuestos por otros productos del mismo negocio)
-- Aditiva e idempotente. No toca adjust_stock ni ninguna fila existente:
-- todos los productos actuales quedan con is_bundle = false.
--
-- Modelo:
--   products.is_bundle            → el producto es un set (sin stock ni variantes propias).
--   product_bundle_components     → componentes del set y cuántas unidades de cada uno lleva.
--   order_items.bundle_snapshot   → en la línea de un set (variant_id NULL): atributos elegidos y,
--                                   por componente, product_id / variant_id / cantidad / nombre /
--                                   costo al momento del pedido. Con eso se restaura el stock y se
--                                   calcula el costo exacto aunque luego cambie el set o el catálogo.
-- Las variantes del set NO se guardan: se derivan en el backend (utils/bundles.js).
--
-- Verificación y rollback: al final de este archivo (comentados).
-- ============================================================================

-- 1) Columnas nuevas
ALTER TABLE products    ADD COLUMN IF NOT EXISTS is_bundle       BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS bundle_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_products_bundles ON products (business_id) WHERE is_bundle;

-- 2) Componentes de cada set
CREATE TABLE IF NOT EXISTS product_bundle_components (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bundle_product_id    UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  -- RESTRICT: no se puede borrar un producto mientras sea componente de un set
  component_product_id UUID NOT NULL REFERENCES products(id)   ON DELETE RESTRICT,
  quantity             INT  NOT NULL DEFAULT 1,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bundle_components_quantity_chk CHECK (quantity BETWEEN 1 AND 10),
  CONSTRAINT bundle_components_not_self_chk CHECK (bundle_product_id <> component_product_id),
  CONSTRAINT uq_bundle_components UNIQUE (bundle_product_id, component_product_id)
);

CREATE INDEX IF NOT EXISTS idx_bundle_components_bundle    ON product_bundle_components (bundle_product_id);
CREATE INDEX IF NOT EXISTS idx_bundle_components_component ON product_bundle_components (component_product_id);
CREATE INDEX IF NOT EXISTS idx_bundle_components_business  ON product_bundle_components (business_id);

-- 3) RLS, igual que product_variants (dueño por business_id) + superadmin como inventory_movements
ALTER TABLE product_bundle_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_bundle_components_all ON product_bundle_components;
CREATE POLICY owner_bundle_components_all ON product_bundle_components
  FOR ALL
  USING (business_id = get_business_id_for_user(auth.uid()))
  WITH CHECK (business_id = get_business_id_for_user(auth.uid()));

DROP POLICY IF EXISTS superadmin_bundle_components_all ON product_bundle_components;
CREATE POLICY superadmin_bundle_components_all ON product_bundle_components
  FOR ALL USING (auth.email() = 'esteban.zita.ia@gmail.com');

-- 4) Reglas en la base (el backend también las valida; esto es la última barrera)

-- 4a) Componente válido: set y componente del MISMO negocio que la fila, el padre es set,
--     el componente no es set (sin sets anidados)
CREATE OR REPLACE FUNCTION check_bundle_component() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_bundle_business UUID; v_bundle_is_bundle BOOLEAN;
  v_comp_business   UUID; v_comp_is_bundle   BOOLEAN;
BEGIN
  SELECT business_id, is_bundle INTO v_bundle_business, v_bundle_is_bundle FROM products WHERE id = NEW.bundle_product_id;
  SELECT business_id, is_bundle INTO v_comp_business,   v_comp_is_bundle   FROM products WHERE id = NEW.component_product_id;
  IF v_bundle_business IS NULL OR v_comp_business IS NULL THEN
    RAISE EXCEPTION 'BUNDLE_PRODUCTO_NO_ENCONTRADO';
  END IF;
  IF v_bundle_business <> NEW.business_id OR v_comp_business <> NEW.business_id THEN
    RAISE EXCEPTION 'BUNDLE_OTRO_NEGOCIO';
  END IF;
  IF NOT v_bundle_is_bundle THEN
    RAISE EXCEPTION 'BUNDLE_NO_ES_SET';
  END IF;
  IF v_comp_is_bundle THEN
    RAISE EXCEPTION 'BUNDLE_ANIDADO';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_check_bundle_component ON product_bundle_components;
CREATE TRIGGER trg_check_bundle_component
  BEFORE INSERT OR UPDATE ON product_bundle_components
  FOR EACH ROW EXECUTE FUNCTION check_bundle_component();

-- 4b) Un set no tiene variantes propias
CREATE OR REPLACE FUNCTION reject_bundle_variants() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND is_bundle) THEN
    RAISE EXCEPTION 'BUNDLE_SIN_VARIANTES';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_reject_bundle_variants ON product_variants;
CREATE TRIGGER trg_reject_bundle_variants
  BEFORE INSERT OR UPDATE OF product_id ON product_variants
  FOR EACH ROW EXECUTE FUNCTION reject_bundle_variants();

-- 4c) Cambiar is_bundle de un producto existente sin romper lo anterior:
--     no se vuelve set si tiene variantes o si ya es componente de otro set;
--     no deja de ser set mientras tenga componentes.
CREATE OR REPLACE FUNCTION check_bundle_flag() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.is_bundle AND NOT OLD.is_bundle THEN
    IF EXISTS (SELECT 1 FROM product_variants WHERE product_id = NEW.id) THEN
      RAISE EXCEPTION 'BUNDLE_SIN_VARIANTES';
    END IF;
    IF EXISTS (SELECT 1 FROM product_bundle_components WHERE component_product_id = NEW.id) THEN
      RAISE EXCEPTION 'BUNDLE_ANIDADO';
    END IF;
  ELSIF OLD.is_bundle AND NOT NEW.is_bundle THEN
    IF EXISTS (SELECT 1 FROM product_bundle_components WHERE bundle_product_id = NEW.id) THEN
      RAISE EXCEPTION 'BUNDLE_CON_COMPONENTES';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_check_bundle_flag ON products;
CREATE TRIGGER trg_check_bundle_flag
  BEFORE UPDATE OF is_bundle ON products
  FOR EACH ROW EXECUTE FUNCTION check_bundle_flag();

-- ============================================================================
-- VERIFICACIÓN (copia en _pruebas/sets/056_verificacion.sql). Debe devolver filas, no "No rows".
-- ============================================================================
-- A) Columnas
-- SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE (table_name = 'products'    AND column_name = 'is_bundle')
--     OR (table_name = 'order_items' AND column_name IN ('bundle_snapshot', 'variant_id'))
--     OR  table_name = 'product_bundle_components'
--  ORDER BY table_name, ordinal_position;
-- B) Restricciones, RLS, políticas, triggers: ver _pruebas/sets/056_verificacion.sql
--
-- ============================================================================
-- ROLLBACK MANUAL (copia en _pruebas/sets/056_rollback.sql). Solo si aún no se vendió ningún set:
-- borrar bundle_snapshot pierde el detalle para restaurar stock de esos pedidos.
-- ============================================================================
-- DROP TRIGGER IF EXISTS trg_check_bundle_flag ON products;
-- DROP TRIGGER IF EXISTS trg_reject_bundle_variants ON product_variants;
-- DROP TRIGGER IF EXISTS trg_check_bundle_component ON product_bundle_components;
-- DROP FUNCTION IF EXISTS check_bundle_flag();
-- DROP FUNCTION IF EXISTS reject_bundle_variants();
-- DROP FUNCTION IF EXISTS check_bundle_component();
-- DROP TABLE IF EXISTS product_bundle_components;
-- DROP INDEX IF EXISTS idx_products_bundles;
-- ALTER TABLE order_items DROP COLUMN IF EXISTS bundle_snapshot;
-- ALTER TABLE products    DROP COLUMN IF EXISTS is_bundle;
