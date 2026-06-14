CREATE TABLE IF NOT EXISTS zita_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE zita_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_zita_settings" ON zita_settings
  FOR ALL USING (auth.email() = 'esteban.zita.ia@gmail.com');

INSERT INTO zita_settings (key, value)
VALUES ('monthly_goal', '{"amount": 10000000}')
ON CONFLICT (key) DO NOTHING;
