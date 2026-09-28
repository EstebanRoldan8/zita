-- Documenta orders/order_items tal como existen hoy en producción.
-- No agrega columnas nuevas: solo deja el repo al día con la realidad.

CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES clients(id),
  client_name       TEXT,
  client_phone      TEXT,
  delivery_type     TEXT,
  delivery_address  TEXT,
  notes             TEXT,
  status            TEXT DEFAULT 'recibido',
  total_amount      NUMERIC(10,2) DEFAULT 0,
  source            TEXT DEFAULT 'manual',
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id),
  variant_id    UUID REFERENCES product_variants(id),
  description   TEXT,
  quantity      INT NOT NULL,
  unit_price    NUMERIC(10,2) NOT NULL,
  total_price   NUMERIC(10,2) NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_business ON orders (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
