ALTER TABLE businesses
ADD COLUMN onboarding_completed BOOLEAN DEFAULT false,
ADD COLUMN onboarding_skipped BOOLEAN DEFAULT false;
