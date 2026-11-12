-- ============================================================
-- ZITA — Panel de empleados (barberos) con invitación por enlace
--
-- 1. employees.user_id: vínculo 1 a 1 entre un empleado y su cuenta de Supabase Auth.
-- 2. employee_invites: invitaciones de un solo uso. Se guarda SOLO el hash SHA-256 del
--    token (el token en claro solo existe en el enlace que el dueño comparte).
-- 3. product_sales.sold_by_employee_id: quién registró la venta (trazabilidad, sin comisión).
--
-- Todo el acceso del empleado pasa por el backend con service role y filtros explícitos
-- por business_id / employee_id: NO se abren políticas RLS nuevas para el rol empleado.
-- Idempotente: se puede correr más de una vez.
-- ============================================================

-- 1. Vínculo empleado ↔ usuario de Auth
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;

-- UNIQUE: un usuario es empleado de a lo sumo un negocio (y el índice sirve al lookup del middleware)
CREATE UNIQUE INDEX IF NOT EXISTS employees_user_id_key ON employees(user_id) WHERE user_id IS NOT NULL;

-- 2. Invitaciones
CREATE TABLE IF NOT EXISTS employee_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id  UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ NULL,
  revoked_at   TIMESTAMPTZ NULL,
  created_by   UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employee_invites_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS employee_invites_token_hash_key ON employee_invites(token_hash);
CREATE INDEX IF NOT EXISTS employee_invites_employee_id_idx ON employee_invites(employee_id);

-- A lo sumo UNA invitación pendiente por empleado (generar un enlace nuevo revoca el anterior)
CREATE UNIQUE INDEX IF NOT EXISTS employee_invites_one_pending
  ON employee_invites(employee_id)
  WHERE used_at IS NULL AND revoked_at IS NULL;

-- Sin políticas: solo el service role (backend) lee o escribe esta tabla
ALTER TABLE employee_invites ENABLE ROW LEVEL SECURITY;

-- 3. Trazabilidad de ventas hechas por un empleado
ALTER TABLE product_sales
  ADD COLUMN IF NOT EXISTS sold_by_employee_id UUID NULL REFERENCES employees(id) ON DELETE SET NULL;
