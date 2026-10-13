-- Fotos por color en productos con variantes. Solo aditivo.
-- Forma: { "negro": ["url1","url2"], "azul": [...] }. La clave es el color normalizado
-- (minúsculas, sin tildes, espacios a guion); el primer elemento es la foto principal.
-- Solo se modifica por los endpoints /api/products/:id/option-images.
-- Número 054: la 053 está reservada para 053_order_accounting.sql (rama feature/dashboard-tienda).

ALTER TABLE products ADD COLUMN IF NOT EXISTS option_images JSONB NOT NULL DEFAULT '{}'::jsonb;
