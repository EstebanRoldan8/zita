ALTER TABLE loyalty_config
  ADD COLUMN IF NOT EXISTS visits_for_reward integer DEFAULT 10,
  ADD COLUMN IF NOT EXISTS reward_service_id uuid REFERENCES services(id);
