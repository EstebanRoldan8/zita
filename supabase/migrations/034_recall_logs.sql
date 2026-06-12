CREATE TABLE IF NOT EXISTS recall_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id),
  date DATE NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE recall_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_recall_logs" ON recall_logs
  FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

CREATE POLICY "superadmin_recall_logs" ON recall_logs
  FOR ALL USING (auth.email() = 'esteban.zita.ia@gmail.com');
