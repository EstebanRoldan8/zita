-- Performance indexes for scalability
CREATE INDEX IF NOT EXISTS idx_appointments_business_scheduled
  ON appointments(business_id, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_appointments_business_status
  ON appointments(business_id, status);

CREATE INDEX IF NOT EXISTS idx_clients_business_phone
  ON clients(business_id, phone);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_business
  ON whatsapp_conversations(business_id, client_phone);

CREATE INDEX IF NOT EXISTS idx_income_business_date
  ON income(business_id, date);

CREATE INDEX IF NOT EXISTS idx_expenses_business_date
  ON expenses(business_id, date);

CREATE INDEX IF NOT EXISTS idx_product_sales_business_created
  ON product_sales(business_id, created_at);
