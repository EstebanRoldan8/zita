-- ============================================================
-- ZITA — Configuración del negocio, fidelización y metas
-- ============================================================

-- ============================================================
-- business_hours — horario base semanal
-- ============================================================
CREATE TABLE business_hours (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id           UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  day_of_week           SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=domingo
  is_open               BOOLEAN NOT NULL DEFAULT true,
  open_time             TIME NOT NULL DEFAULT '08:00',
  close_time            TIME NOT NULL DEFAULT '18:00',
  slot_duration_minutes INT NOT NULL DEFAULT 30,
  UNIQUE (business_id, day_of_week)
);

ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_business_hours_all" ON business_hours
  FOR ALL TO authenticated
  USING (auth.email() = 'esteban.zita.ia@gmail.com')
  WITH CHECK (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_business_hours" ON business_hours
  FOR ALL TO authenticated
  USING (business_id = get_business_id_for_user(auth.uid()))
  WITH CHECK (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- business_closed_days — días especiales cerrado
-- ============================================================
CREATE TABLE business_closed_days (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  reason      TEXT,
  is_full_day BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (business_id, date)
);

ALTER TABLE business_closed_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_closed_days_all" ON business_closed_days
  FOR ALL TO authenticated
  USING (auth.email() = 'esteban.zita.ia@gmail.com')
  WITH CHECK (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_closed_days" ON business_closed_days
  FOR ALL TO authenticated
  USING (business_id = get_business_id_for_user(auth.uid()))
  WITH CHECK (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- client_loyalty — puntos de fidelización por negocio-cliente
-- ============================================================
CREATE TABLE client_loyalty (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  points       INT NOT NULL DEFAULT 0 CHECK (points >= 0),
  total_visits INT NOT NULL DEFAULT 0 CHECK (total_visits >= 0),
  last_visit   DATE,
  UNIQUE (business_id, client_id)
);

ALTER TABLE client_loyalty ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_loyalty_all" ON client_loyalty
  FOR ALL TO authenticated
  USING (auth.email() = 'esteban.zita.ia@gmail.com')
  WITH CHECK (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_loyalty" ON client_loyalty
  FOR ALL TO authenticated
  USING (business_id = get_business_id_for_user(auth.uid()))
  WITH CHECK (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- monthly_goals — metas mensuales de ingresos
-- ============================================================
CREATE TABLE monthly_goals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  month       DATE NOT NULL,  -- siempre el primer día del mes (ej: 2026-04-01)
  income_goal NUMERIC(12, 2) NOT NULL CHECK (income_goal > 0),
  UNIQUE (business_id, month)
);

ALTER TABLE monthly_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_monthly_goals_all" ON monthly_goals
  FOR ALL TO authenticated
  USING (auth.email() = 'esteban.zita.ia@gmail.com')
  WITH CHECK (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_monthly_goals" ON monthly_goals
  FOR ALL TO authenticated
  USING (business_id = get_business_id_for_user(auth.uid()))
  WITH CHECK (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- businesses — columnas adicionales
-- ============================================================
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS whatsapp_notify  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS owner_whatsapp   TEXT;
