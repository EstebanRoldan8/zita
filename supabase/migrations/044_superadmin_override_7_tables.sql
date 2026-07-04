-- ============================================================
-- Add superadmin override policies to 7 tables
-- ============================================================
-- Context: 7 tables (030-031) have RLS with "business_isolation"
-- policy for regular users, but lack a superadmin override policy.
-- This migration adds superadmin access (auth.email() = 'esteban.zita.ia@gmail.com')
-- while preserving existing business_isolation policies.
--
-- RLS with multiple policies uses implicit OR: if ANY policy allows
-- the operation, access is granted. This means these new superadmin
-- policies coexist with existing business_isolation policies.

-- ============================================================
-- 1. cash_register — Superadmin override
-- ============================================================
CREATE POLICY "superadmin_cash_register_all" ON cash_register
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

-- ============================================================
-- 2. loyalty_points — Superadmin override
-- ============================================================
CREATE POLICY "superadmin_loyalty_points_all" ON loyalty_points
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

-- ============================================================
-- 3. campaigns — Superadmin override
-- ============================================================
CREATE POLICY "superadmin_campaigns_all" ON campaigns
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

-- ============================================================
-- 4. campaign_messages — Superadmin override
-- ============================================================
CREATE POLICY "superadmin_campaign_messages_all" ON campaign_messages
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

-- ============================================================
-- 5. review_requests — Superadmin override
-- ============================================================
CREATE POLICY "superadmin_review_requests_all" ON review_requests
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

-- ============================================================
-- 6. automations — Superadmin override
-- ============================================================
CREATE POLICY "superadmin_automations_all" ON automations
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

-- ============================================================
-- 7. payments — Superadmin override
-- ============================================================
CREATE POLICY "superadmin_payments_all" ON payments
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');
