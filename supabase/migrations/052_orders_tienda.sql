-- Pedidos para tienda: pago y envío. Solo aditivo.
-- Los valores se validan en el backend (orders.controller.js); sin CHECK en la base.
-- customer_email y wompi_transaction_id quedan reservadas para la web pública.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_carrier TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS wompi_transaction_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_business_payment ON orders (business_id, payment_status);
