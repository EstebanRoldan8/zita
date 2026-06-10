CREATE TABLE IF NOT EXISTS scheduled_downgrades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  new_plan TEXT NOT NULL,
  applies_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_id)
);

ALTER TABLE scheduled_downgrades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "businesses_own_downgrades" ON scheduled_downgrades
  FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

CREATE POLICY "superadmin_all_downgrades" ON scheduled_downgrades
  FOR ALL USING (auth.email() = 'esteban.zita.ia@gmail.com');
