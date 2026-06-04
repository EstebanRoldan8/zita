ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2) DEFAULT NULL;
COMMENT ON COLUMN products.cost_price IS 'Costo del producto (opcional). Si está definido, se genera egreso automático al vender.';
