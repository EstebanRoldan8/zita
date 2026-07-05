-- Bot daily message limits tracking
-- Track messages per client per day and per business per day

CREATE TABLE IF NOT EXISTS bot_daily_message_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_phone text,
  date DATE NOT NULL,
  message_count integer NOT NULL DEFAULT 0,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  UNIQUE(business_id, client_phone, date)
);

CREATE INDEX IF NOT EXISTS idx_bot_daily_counts_business_date
ON bot_daily_message_counts(business_id, date);

CREATE INDEX IF NOT EXISTS idx_bot_daily_counts_client_date
ON bot_daily_message_counts(business_id, client_phone, date);

-- RPC function to atomically increment message count for a client per day
CREATE OR REPLACE FUNCTION increment_message_count(
  p_business_id uuid,
  p_client_phone text,
  p_date date
)
RETURNS void AS $$
BEGIN
  INSERT INTO bot_daily_message_counts (business_id, client_phone, date, message_count)
  VALUES (p_business_id, p_client_phone, p_date, 1)
  ON CONFLICT (business_id, client_phone, date)
  DO UPDATE SET message_count = message_count + 1, updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- Row Level Security
ALTER TABLE bot_daily_message_counts ENABLE ROW LEVEL SECURITY;

-- Policy: Business owners can only see counts for their own business
CREATE POLICY bot_daily_counts_select_owner ON bot_daily_message_counts
  FOR SELECT
  USING (business_id = get_business_id_for_user(auth.uid()));

-- Policy: Superadmin can see all counts
CREATE POLICY bot_daily_counts_select_superadmin ON bot_daily_message_counts
  FOR SELECT
  USING (auth.email() = 'esteban.zita.ia@gmail.com');
