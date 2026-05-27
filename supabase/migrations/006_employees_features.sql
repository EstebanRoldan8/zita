-- ============================================================
-- ZITA — Employees: FK en appointments, RLS y función helper
-- Nota: la tabla employees ya fue creada en 004_phase2_schema.sql
-- ============================================================

-- ============================================================
-- Agregar employee_id en appointments (nullable)
-- ============================================================
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES employees(id) ON DELETE SET NULL;

-- ============================================================
-- RLS para employees
-- ============================================================
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_employees_all" ON employees
  FOR ALL
  USING (auth.email() = 'esteban.zita.ia@gmail.com');

CREATE POLICY "owner_employees_own" ON employees
  FOR ALL
  USING (business_id = get_business_id_for_user(auth.uid()));

-- ============================================================
-- Función: retorna el empleado activo con menos citas
-- en el slot de fecha+hora indicado (ventana de ±30 min)
-- ============================================================
CREATE OR REPLACE FUNCTION get_available_employee(
  p_business_id UUID,
  p_date        DATE,
  p_time        TIME
)
RETURNS UUID AS $$
DECLARE
  v_slot_start TIMESTAMPTZ;
  v_slot_end   TIMESTAMPTZ;
  v_employee_id UUID;
BEGIN
  v_slot_start := (p_date + p_time)::TIMESTAMPTZ - INTERVAL '30 minutes';
  v_slot_end   := (p_date + p_time)::TIMESTAMPTZ + INTERVAL '30 minutes';

  SELECT e.id
  INTO v_employee_id
  FROM employees e
  LEFT JOIN appointments a
    ON  a.employee_id  = e.id
    AND a.scheduled_at BETWEEN v_slot_start AND v_slot_end
    AND a.status NOT IN ('cancelled')
  WHERE e.business_id = p_business_id
    AND e.is_active   = true
  GROUP BY e.id
  ORDER BY COUNT(a.id) ASC
  LIMIT 1;

  RETURN v_employee_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;
