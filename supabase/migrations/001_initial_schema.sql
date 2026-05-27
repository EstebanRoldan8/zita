-- ============================================================
-- ZITA — Esquema inicial
-- ============================================================

-- Extensión para UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- businesses — negocios clientes de ZITA
-- ============================================================
CREATE TABLE businesses (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name                    TEXT NOT NULL,
  business_type           TEXT NOT NULL DEFAULT 'barberia',
  status                  TEXT NOT NULL DEFAULT 'trial',  -- trial | active | suspended
  owner_email             TEXT NOT NULL,
  phone                   TEXT,
  address                 TEXT,
  whatsapp_token          TEXT,                           -- guardado encriptado desde el backend
  whatsapp_phone_number_id TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- services — servicios de cada negocio
-- ============================================================
CREATE TABLE services (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  description      TEXT,
  duration_minutes INT NOT NULL DEFAULT 30,
  price            NUMERIC(10, 2) NOT NULL DEFAULT 0,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- clients — clientes de cada negocio
-- ============================================================
CREATE TABLE clients (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT,
  total_spent   NUMERIC(10, 2) NOT NULL DEFAULT 0,
  visits_count  INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, phone)
);

-- ============================================================
-- appointments — citas
-- ============================================================
CREATE TABLE appointments (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id    UUID REFERENCES clients(id) ON DELETE SET NULL,
  service_id   UUID REFERENCES services(id) ON DELETE SET NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | completed | cancelled
  price        NUMERIC(10, 2),
  source       TEXT NOT NULL DEFAULT 'manual',   -- manual | whatsapp
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- whatsapp_conversations — estado de conversaciones activas
-- ============================================================
CREATE TABLE whatsapp_conversations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_phone    TEXT NOT NULL,
  client_name     TEXT,
  state           TEXT NOT NULL DEFAULT 'greeting',  -- greeting | selecting_service | selecting_date | confirming | done
  context         JSONB DEFAULT '{}',                -- datos de la cita en construcción
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, client_phone)
);

-- ============================================================
-- support_conversations — conversaciones del chat de soporte
-- ============================================================
CREATE TABLE support_conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'bot',  -- bot | human | closed
  assigned_to TEXT,                         -- email del superadmin si fue escalado
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- support_messages — mensajes del chat de soporte
-- ============================================================
CREATE TABLE support_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  sender          TEXT NOT NULL,  -- bot | business | superadmin
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- notifications — notificaciones para el superadmin
-- ============================================================
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type       TEXT NOT NULL,   -- support_escalation | new_business | appointment_alert
  title      TEXT NOT NULL,
  body       TEXT,
  read       BOOLEAN NOT NULL DEFAULT false,
  metadata   JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
