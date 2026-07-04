-- ============================================================
-- RLS para contact_requests y scheduler_locks
-- ============================================================
-- Contexto: ninguna de las dos tablas tenía RLS habilitado (ver
-- migración 028, que documentaba la decisión de NO habilitarlo).
-- Ambas tablas solo son escritas/leídas desde el backend con
-- supabaseAdmin (service_role key), que siempre puede saltarse RLS
-- (BYPASSRLS). El problema es que, sin RLS, PostgREST expone estas
-- tablas a CUALQUIER cliente que tenga la anon key (pública, va en
-- el bundle del frontend) sin necesidad de sesión ni pertenecer a
-- ningún negocio. Esto permite volcar todo `contact_requests`
-- (nombre, whatsapp, email, mensaje, ciudad — datos de leads del
-- formulario de contacto del sitio de ZITA) y leer/escribir
-- `scheduler_locks` desde fuera del backend.

-- ------------------------------------------------------------
-- contact_requests: tabla GLOBAL (no tiene business_id).
-- Son leads del formulario de contacto del sitio público de ZITA,
-- no pertenecen a ningún negocio/tenant. Solo el superadmin de ZITA
-- debe poder leerlos/gestionarlos vía RLS; la inserción pública se
-- sigue haciendo desde el backend con supabaseAdmin (bypassa RLS),
-- así que no se necesita política de INSERT para anon/authenticated.
-- ------------------------------------------------------------
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "superadmin_contact_requests_all" ON contact_requests;

CREATE POLICY "superadmin_contact_requests_all" ON contact_requests
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

-- ------------------------------------------------------------
-- scheduler_locks: tabla interna de locks para el scheduler del
-- backend (node-cron). No es user-facing y no tiene business_id.
-- Solo el backend (service_role, que bypassa RLS) debe poder
-- acceder; con RLS habilitado y una política restringida a
-- service_role, cualquier acceso vía anon/authenticated queda
-- bloqueado por defecto.
-- ------------------------------------------------------------
ALTER TABLE scheduler_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_scheduler_locks_all" ON scheduler_locks;

CREATE POLICY "service_role_scheduler_locks_all" ON scheduler_locks
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
