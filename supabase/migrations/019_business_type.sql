ALTER TABLE businesses
ADD COLUMN IF NOT EXISTS business_type text DEFAULT 'barberia';

UPDATE businesses
SET business_type = 'barberia'
WHERE business_type IS NULL;
