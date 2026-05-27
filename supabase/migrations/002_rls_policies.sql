-- ============================================================
-- ZITA — RLS Policies
-- ============================================================

-- ============================================================
-- Función helper: resuelve el business_id del usuario autenticado
-- ============================================================
CREATE OR REPLACE FUNCTION get_business_id_for_user(user_id UUID)
RETURNS UUID AS $$
  SELECT id FROM businesses WHERE businesses.user_id = $1 LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- Habilitar RLS en todas las tablas
-- ============================================================
ALTER TABLE businesses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE services               ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients                ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- businesses
-- ============================================================
CREATE POLICY "superadmin_businesses_all" ON businesses
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_businesses_own" ON businesses
  FOR ALL
  USING (user_id = auth.uid());

-- ============================================================
-- services
-- ============================================================
CREATE POLICY "superadmin_services_all" ON services
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_services_own" ON services
  FOR ALL
  USING (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- clients
-- ============================================================
CREATE POLICY "superadmin_clients_all" ON clients
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_clients_own" ON clients
  FOR ALL
  USING (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- appointments
-- ============================================================
CREATE POLICY "superadmin_appointments_all" ON appointments
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_appointments_own" ON appointments
  FOR ALL
  USING (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- whatsapp_conversations
-- ============================================================
CREATE POLICY "superadmin_wa_conversations_all" ON whatsapp_conversations
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_wa_conversations_own" ON whatsapp_conversations
  FOR ALL
  USING (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- support_conversations
-- ============================================================
CREATE POLICY "superadmin_support_conv_all" ON support_conversations
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_support_conv_own" ON support_conversations
  FOR ALL
  USING (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- support_messages
-- ============================================================
CREATE POLICY "superadmin_support_msg_all" ON support_messages
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_support_msg_own" ON support_messages
  FOR ALL
  USING (
    conversation_id IN (
      SELECT id FROM support_conversations
      WHERE business_id = get_business_id_for_user(auth.uid())
    )
  );

-- ============================================================
-- notifications (solo superadmin)
-- ============================================================
CREATE POLICY "superadmin_notifications_all" ON notifications
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');
