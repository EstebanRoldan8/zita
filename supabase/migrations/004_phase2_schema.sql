-- ============================================================
-- ZITA — Fase 2: Gestión avanzada del negocio
-- ============================================================

-- ============================================================
-- employees — empleados del negocio
-- ============================================================
CREATE TABLE employees (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id        UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  phone              TEXT,
  email              TEXT,
  commission_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- cash_register — caja diaria del negocio
-- ============================================================
CREATE TABLE cash_register (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  total_income    NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_expenses  NUMERIC(10, 2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, date)
);

-- ============================================================
-- expenses — gastos del negocio
-- ============================================================
CREATE TABLE expenses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,  -- insumos | arriendo | servicios | otro
  amount      NUMERIC(10, 2) NOT NULL,
  description TEXT,
  date        DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- products — inventario básico del negocio
-- ============================================================
CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  stock       INT NOT NULL DEFAULT 0,
  min_stock   INT NOT NULL DEFAULT 0,
  price       NUMERIC(10, 2) NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- loyalty_points — programa de fidelización por cliente
-- ============================================================
CREATE TABLE loyalty_points (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  points      INT NOT NULL,
  reason      TEXT,  -- 'visita completada' | 'canje' | etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
