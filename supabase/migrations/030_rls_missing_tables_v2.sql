ALTER TABLE cash_register ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_isolation" ON cash_register FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

ALTER TABLE loyalty_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_isolation" ON loyalty_points FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_isolation" ON campaigns FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

ALTER TABLE campaign_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_isolation" ON campaign_messages FOR ALL USING (campaign_id IN (SELECT id FROM campaigns WHERE business_id = get_business_id_for_user(auth.uid())));

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_isolation" ON review_requests FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_isolation" ON automations FOR ALL USING (business_id = get_business_id_for_user(auth.uid()));
