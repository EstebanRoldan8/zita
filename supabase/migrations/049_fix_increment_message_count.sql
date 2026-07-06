-- Fix: increment_message_count ambiguous column reference
-- Issue: "message_count = message_count + 1" was ambiguous
-- Solution: Explicitly reference table name to read current value, NOT EXCLUDED
-- (EXCLUDED.message_count is always 1 from VALUES clause; we need the actual current row value)

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
    message_count = bot_daily_message_counts.message_count + 1,
    updated_at = now();
END;
$$ LANGUAGE plpgsql;
