-- Fix: increment_message_count ambiguous column reference
-- Issue: "message_count = message_count + 1" was ambiguous
-- Solution: Use EXCLUDED pseudo-table to reference the attempted insert

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
  DO UPDATE SET
    message_count = EXCLUDED.message_count + 1,
    updated_at = now();
END;
$$ LANGUAGE plpgsql;
