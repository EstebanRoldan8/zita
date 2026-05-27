-- ============================================================
-- ZITA — Módulo de egresos (idempotente)
-- ============================================================

-- Columnas opcionales que pueden no existir aún
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category    TEXT NOT NULL DEFAULT 'otro';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS description TEXT;

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Superadmin: acceso total
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'expenses' AND policyname = 'superadmin_expenses_all'
  ) THEN
    CREATE POLICY "superadmin_expenses_all" ON expenses
      FOR ALL TO authenticated
      USING (auth.email() = 'esteban.zita.ia@gmail.com')
      WITH CHECK (auth.email() = 'esteban.zita.ia@gmail.com');
  END IF;
END $$;

-- Dueño del negocio: solo sus egresos
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'expenses' AND policyname = 'owner_expenses'
  ) THEN
    CREATE POLICY "owner_expenses" ON expenses
      FOR ALL TO authenticated
      USING (business_id = get_business_id_for_user(auth.uid()))
      WITH CHECK (business_id = get_business_id_for_user(auth.uid()));
  END IF;
END $$;
