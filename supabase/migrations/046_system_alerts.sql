-- ============================================================
-- System Alerts — tabla NUEVA para alertas críticas del sistema
-- (Separada de notifications existente)
-- ============================================================

CREATE TABLE system_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  business_id UUID,
  metadata JSONB DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS (solo superadmin puede leer/escribir)
ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;

-- Policy: solo superadmin
CREATE POLICY "superadmin_system_alerts_all" ON system_alerts
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

-- Index para queries de alertas no leídas
CREATE INDEX idx_system_alerts_read_at ON system_alerts(read_at, created_at DESC);
