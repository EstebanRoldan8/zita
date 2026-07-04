-- ============================================================
-- Constraints para prevenir race conditions (Round 1)
-- ============================================================

-- 1. UNIQUE parcial: prevenir doble-booking
-- (mismo negocio + empleado + hora, solo para citas activas)
CREATE UNIQUE INDEX IF NOT EXISTS idx_no_double_booking ON appointments
  (business_id, employee_id, scheduled_at)
  WHERE status IN ('pending', 'confirmed');

-- 2. UNIQUE parcial: prevenir income duplicado por cita
-- (una sola fila de income por appointment, excepto nulls)
CREATE UNIQUE INDEX IF NOT EXISTS idx_income_appointment_unique ON income
  (appointment_id) WHERE appointment_id IS NOT NULL;

-- 3. CHECK: stock no negativo en products
-- (ya existe en product_variants, falta en products)
-- Nota: "ADD CONSTRAINT IF NOT EXISTS" no es sintaxis válida en PostgreSQL
-- (mismo problema ya corregido en 041 para CREATE POLICY IF NOT EXISTS),
-- por eso se usa un DO block para hacerlo idempotente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_products_stock_non_negative'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT check_products_stock_non_negative
      CHECK (stock >= 0);
  END IF;
END $$;
