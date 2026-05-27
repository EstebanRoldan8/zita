-- ============================================================
-- Add country column to businesses table
-- ============================================================

ALTER TABLE businesses
ADD COLUMN country TEXT NOT NULL DEFAULT 'colombia';

-- Add comment for documentation
COMMENT ON COLUMN businesses.country IS 'Country where the business is located (colombia, mexico, argentina, chile, peru, ecuador, venezuela, panama, costa_rica, otro)';
