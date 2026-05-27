-- ============================================================
-- ZITA — Fase 3: Marketing y automatización
-- ============================================================

-- ============================================================
-- campaigns — campañas de mensajes masivos por WhatsApp
-- ============================================================
CREATE TABLE campaigns (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  message_template TEXT NOT NULL,
  target_segment   TEXT NOT NULL DEFAULT 'all',  -- all | inactive | frequent
  status           TEXT NOT NULL DEFAULT 'draft', -- draft | scheduled | sent
  scheduled_at     TIMESTAMPTZ,
  sent_count       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- campaign_messages — mensajes individuales enviados por campaña
-- ============================================================
CREATE TABLE campaign_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- review_requests — solicitudes de reseña post-cita
-- ============================================================
CREATE TABLE review_requests (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sent_at        TIMESTAMPTZ,
  clicked        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- automations — configuración de automatizaciones del negocio
-- ============================================================
CREATE TABLE automations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,  -- inactive_client | birthday | post_appointment | review_request
  config      JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, type)
);
