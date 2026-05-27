-- WhatsApp integration setup
ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
ADD COLUMN IF NOT EXISTS whatsapp_access_token text;

-- Update test business with WhatsApp phone number
UPDATE businesses
SET whatsapp_phone_number_id = '1020949014445212'
WHERE id = 'd26bc18e-bbcf-4ca3-bba3-d66d1025132f';

-- Create whatsapp_conversations table for storing chat history
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_phone text NOT NULL,
  messages jsonb DEFAULT '[]'::jsonb,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- Unique constraint for business + client phone
ALTER TABLE whatsapp_conversations
ADD CONSTRAINT unique_business_client UNIQUE(business_id, client_phone);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_business_phone
ON whatsapp_conversations(business_id, client_phone);
