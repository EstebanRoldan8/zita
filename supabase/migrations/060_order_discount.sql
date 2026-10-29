-- ============================================================================
-- 060 — Descuento en pesos por pedido y cliente opcional. Solo aditivo e idempotente.
-- total_amount pasa a ser el total NETO: subtotal + envío − descuento (lo calcula el servidor).
-- Los pedidos antiguos quedan con descuento 0.
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,0) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_discount_amount_check') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_discount_amount_check CHECK (discount_amount >= 0);
  END IF;
END $$;

-- Cliente opcional: en producción ya son NULL (verificado), esto es no-op si ya lo son.
ALTER TABLE orders ALTER COLUMN client_name DROP NOT NULL;
ALTER TABLE orders ALTER COLUMN client_phone DROP NOT NULL;

NOTIFY pgrst, 'reload schema';

-- VERIFICACIÓN:
-- SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
--  WHERE table_name = 'orders' AND column_name IN ('discount_amount','client_name','client_phone');
--
-- ROLLBACK (solo si hace falta deshacer; los pedidos con descuento perderían ese dato):
-- ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_discount_amount_check;
-- ALTER TABLE orders DROP COLUMN IF EXISTS discount_amount;
