-- Row Level Security for tables missing explicit RLS policies
-- This migration ensures all multi-tenant tables have RLS enabled

-- Orders table - requires RLS for multi-tenant isolation
ALTER TABLE IF EXISTS orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users can only access own business orders" ON orders
  FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

-- Order items table - inherits business_id through order_id FK
ALTER TABLE IF EXISTS order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users can only access own business order items" ON order_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id
      AND o.business_id = get_business_id_for_user(auth.uid())
    )
  );

-- Product variants table - requires RLS for multi-tenant isolation
ALTER TABLE IF EXISTS product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users can only access own business product variants" ON product_variants
  FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

-- Product sales table - requires RLS for multi-tenant isolation
ALTER TABLE IF EXISTS product_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users can only access own business product sales" ON product_sales
  FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

-- Scheduler locks table - Does NOT need RLS
-- Reason: scheduler_locks is internal to ZITA backend, NOT user-facing
-- It contains database-level locks for job scheduling, not business-specific data
-- Access is restricted by backend code, not by RLS

-- Contact requests table - Does NOT need RLS per business
-- Reason: contact_requests are public landing page submissions
-- They are not filtered by business_id as they come from unauthenticated users
-- Admin access is restricted by backend auth checks, not RLS
