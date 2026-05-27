-- ============================================================
-- ZITA — Funciones y triggers
-- ============================================================

-- ============================================================
-- Función: actualiza total_spent y visits_count en clients
-- cuando una cita pasa a estado 'completed'
-- ============================================================
CREATE OR REPLACE FUNCTION update_client_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo actúa cuando el status cambia a 'completed'
  IF NEW.status = 'completed' AND OLD.status <> 'completed' THEN
    IF NEW.client_id IS NOT NULL AND NEW.service_id IS NOT NULL THEN
      UPDATE clients
      SET
        visits_count = visits_count + 1,
        total_spent  = total_spent + COALESCE(NEW.price, 0)
      WHERE id = NEW.client_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Trigger: se dispara en cada UPDATE de appointments
-- ============================================================
CREATE TRIGGER trg_update_client_stats
  AFTER UPDATE ON appointments
  FOR EACH ROW
  EXECUTE FUNCTION update_client_stats();
