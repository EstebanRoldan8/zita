-- ============================================================
-- ZITA — Fidelización de puntos
-- ============================================================

-- Puntos acumulados en la tabla de clientes
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS loyalty_points integer NOT NULL DEFAULT 0;

-- Configuración de puntos por negocio
CREATE TABLE IF NOT EXISTS loyalty_config (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  points_per_appointment  integer     NOT NULL DEFAULT 10,
  points_per_product      integer     NOT NULL DEFAULT 5,
  rewards_description     text,
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now(),
  UNIQUE (business_id)
);

-- Historial de transacciones de puntos
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id      uuid        NOT NULL REFERENCES clients(id)   ON DELETE CASCADE,
  points         integer     NOT NULL,
  reason         text        NOT NULL,
  appointment_id uuid        REFERENCES appointments(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now()
);

-- ============================================================
-- RLS — loyalty_config
-- ============================================================

ALTER TABLE loyalty_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmin_loyalty_config_all" ON loyalty_config;
CREATE POLICY "superadmin_loyalty_config_all" ON loyalty_config
  FOR ALL USING (auth.email() = 'esteban.zita.ia@gmail.com');

DROP POLICY IF EXISTS "owner_loyalty_config_own" ON loyalty_config;
CREATE POLICY "owner_loyalty_config_own" ON loyalty_config
  FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- RLS — loyalty_transactions
-- ============================================================

ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmin_loyalty_tx_all" ON loyalty_transactions;
CREATE POLICY "superadmin_loyalty_tx_all" ON loyalty_transactions
  FOR ALL USING (auth.email() = 'esteban.zita.ia@gmail.com');

DROP POLICY IF EXISTS "owner_loyalty_tx_own" ON loyalty_transactions;
CREATE POLICY "owner_loyalty_tx_own" ON loyalty_transactions
  FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));
