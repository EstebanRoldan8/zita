CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id),
  plan TEXT NOT NULL, -- lite | estandar | pro
  amount INTEGER NOT NULL, -- en centavos COP
  currency TEXT DEFAULT 'COP',
  status TEXT DEFAULT 'pending', -- pending | approved | declined | voided | error
  payment_method TEXT, -- CARD | NEQUI | PSE | BANCOLOMBIA_TRANSFER
  wompi_transaction_id TEXT,
  wompi_reference TEXT UNIQUE,
  country TEXT DEFAULT 'colombia',
  provider TEXT DEFAULT 'wompi', -- wompi | mercadopago (futuro)
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_isolation" ON payments
  FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

CREATE INDEX idx_payments_business_id ON payments(business_id);
CREATE INDEX idx_payments_wompi_reference ON payments(wompi_reference);
CREATE INDEX idx_payments_status ON payments(status);
