-- ============================================================
-- ZITA — Tabla de ingresos manuales (Módulo Caja)
-- ============================================================

CREATE TABLE income (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  category        TEXT NOT NULL DEFAULT 'servicios',  -- servicios | productos | otro
  description     TEXT,
  custom_category TEXT,                               -- nombre libre cuando category='otro'
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  services_detail TEXT,                               -- descripcion libre de servicios realizados
  source          TEXT NOT NULL DEFAULT 'manual',     -- manual | appointment
  appointment_id  UUID REFERENCES appointments(id) ON DELETE SET NULL,
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE income ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_income_all" ON income
  FOR ALL TO authenticated
  USING (auth.email() = 'esteban.zita.ia@gmail.com')
  WITH CHECK (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_income" ON income
  FOR ALL TO authenticated
  USING (business_id = get_business_id_for_user(auth.uid()))
  WITH CHECK (business_id = get_business_id_for_user(auth.uid()));
