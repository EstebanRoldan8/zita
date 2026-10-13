-- Contabilidad de pedidos de tienda: ingreso y costo ligados al pedido. Solo aditivo.
-- Un pedido tiene a lo sumo un ingreso y un egreso (índices únicos parciales):
-- marcar pagado dos veces no duplica. ON DELETE CASCADE: si se borra el pedido, se borran.

ALTER TABLE income   ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE CASCADE;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_income_order   ON income   (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_expenses_order ON expenses (order_id) WHERE order_id IS NOT NULL;
