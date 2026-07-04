-- ============================================================
-- Archive clients instead of hard delete for data preservation
-- ============================================================
-- Add archived column to clients table for soft-delete pattern
-- Borrado real solo en flujo de privacidad/GDPR

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

-- Index for filtering active clients
CREATE INDEX IF NOT EXISTS idx_clients_archived ON clients(business_id, archived);
