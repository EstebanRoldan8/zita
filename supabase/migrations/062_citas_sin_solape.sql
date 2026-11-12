-- ============================================================================
-- 062 — Citas sin solape por empleado (la BD lo garantiza, no solo el código).
--
-- Antes: el índice único idx_no_double_booking (042) solo bloqueaba dos citas con la MISMA hora de inicio.
-- Una cita de 60 min a las 10:00 y otra a las 10:30 con el mismo empleado pasaban.
--
-- Ahora:
--   1. appointments.ends_at = scheduled_at + duración del servicio (30 min si no tiene), calculado por trigger.
--   2. Restricción EXCLUDE: dos citas activas (pending/confirmed) del mismo empleado no pueden cruzarse.
--      Si dos peticiones simultáneas intentan el mismo hueco, una falla con el código 23P01 y el backend
--      responde "ese horario ya no está disponible" (igual que con 23505).
--
-- Seguro de correr con datos existentes: si ya hay citas activas que se cruzan, NO crea la restricción
-- (avisa con NOTICE y deja la consulta para revisarlas). Se vuelve a correr después de resolverlas.
-- Idempotente. No borra ni modifica citas (solo rellena ends_at).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_appointment_ends_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.ends_at := NEW.scheduled_at + make_interval(mins => COALESCE(
    (SELECT s.duration_minutes FROM services s WHERE s.id = NEW.service_id), 30));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_appointments_ends_at ON appointments;
CREATE TRIGGER trg_appointments_ends_at
  BEFORE INSERT OR UPDATE OF scheduled_at, service_id ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_appointment_ends_at();

-- Rellenar las citas existentes
UPDATE appointments a
   SET ends_at = a.scheduled_at + make_interval(mins => COALESCE(s.duration_minutes, 30))
  FROM services s
 WHERE s.id = a.service_id AND a.ends_at IS NULL;
UPDATE appointments SET ends_at = scheduled_at + interval '30 minutes' WHERE ends_at IS NULL;

ALTER TABLE appointments ALTER COLUMN ends_at SET NOT NULL;

DO $$
DECLARE
  n_solapes integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_overlap') THEN
    RAISE NOTICE 'appointments_no_overlap ya existe';
    RETURN;
  END IF;

  SELECT count(*) INTO n_solapes
    FROM appointments a
    JOIN appointments b
      ON a.business_id = b.business_id AND a.employee_id = b.employee_id AND a.id < b.id
   WHERE a.employee_id IS NOT NULL
     AND a.status IN ('pending', 'confirmed') AND b.status IN ('pending', 'confirmed')
     AND tstzrange(a.scheduled_at, a.ends_at, '[)') && tstzrange(b.scheduled_at, b.ends_at, '[)');

  IF n_solapes > 0 THEN
    RAISE NOTICE 'NO se creó appointments_no_overlap: hay % pares de citas activas que se cruzan. Revísalas con la consulta de VERIFICACIÓN (1), corrígelas y vuelve a correr esta migración.', n_solapes;
    RETURN;
  END IF;

  ALTER TABLE appointments
    ADD CONSTRAINT appointments_no_overlap
    EXCLUDE USING gist (
      business_id WITH =,
      employee_id WITH =,
      tstzrange(scheduled_at, ends_at, '[)') WITH &&
    ) WHERE (status IN ('pending', 'confirmed') AND employee_id IS NOT NULL);
  RAISE NOTICE 'appointments_no_overlap creada';
END $$;

NOTIFY pgrst, 'reload schema';

-- VERIFICACIÓN:
-- (1) Citas activas que se cruzan (deberían ser 0 para que exista la restricción):
--   SELECT a.business_id, a.employee_id, a.id AS cita_a, a.scheduled_at AS inicio_a, a.ends_at AS fin_a,
--          b.id AS cita_b, b.scheduled_at AS inicio_b, b.ends_at AS fin_b
--     FROM appointments a JOIN appointments b
--       ON a.business_id = b.business_id AND a.employee_id = b.employee_id AND a.id < b.id
--    WHERE a.status IN ('pending','confirmed') AND b.status IN ('pending','confirmed')
--      AND tstzrange(a.scheduled_at, a.ends_at, '[)') && tstzrange(b.scheduled_at, b.ends_at, '[)')
--    ORDER BY a.scheduled_at;
-- (2) ¿Existe la restricción?
--   SELECT conname FROM pg_constraint WHERE conname = 'appointments_no_overlap';
-- (3) ends_at relleno:
--   SELECT count(*) FROM appointments WHERE ends_at IS NULL;   -- 0
--
-- ROLLBACK (si hace falta):
--   ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;
--   DROP TRIGGER IF EXISTS trg_appointments_ends_at ON appointments;
--   DROP FUNCTION IF EXISTS set_appointment_ends_at();
--   ALTER TABLE appointments DROP COLUMN IF EXISTS ends_at;
