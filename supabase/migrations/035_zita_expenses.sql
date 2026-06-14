CREATE TABLE IF NOT EXISTS zita_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  description TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT DEFAULT 'USD',
  recurring BOOLEAN DEFAULT false,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE zita_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_zita_expenses" ON zita_expenses
  FOR ALL USING (auth.email() = 'esteban.zita.ia@gmail.com');
