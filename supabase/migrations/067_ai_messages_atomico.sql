-- ============================================================
-- ZITA — Contador diario de mensajes del asistente IA, atómico
--
-- Antes el backend leía ai_messages_today, comparaba con el límite del plan y escribía +1:
-- dos mensajes simultáneos leían el mismo valor y ambos pasaban (se superaba el límite).
--
-- consume_ai_message hace todo en UN solo UPDATE condicional: Postgres bloquea la fila, y la
-- segunda transacción vuelve a evaluar el WHERE con el valor ya actualizado (READ COMMITTED).
-- Devuelve el contador nuevo, o NULL si el negocio ya llegó al límite (o no existe).
-- Si es un día nuevo, el contador arranca en 1.
--
-- Solo la usa el backend (service role): se quita a anon/authenticated para que un usuario no
-- pueda gastar el cupo de otro negocio llamándola por la API.
-- Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION consume_ai_message(
  p_business_id uuid,
  p_date date,
  p_limit int
)
RETURNS int
LANGUAGE plpgsql
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE businesses
     SET ai_messages_today = CASE
           WHEN ai_messages_date = p_date THEN COALESCE(ai_messages_today, 0) + 1
           ELSE 1
         END,
         ai_messages_date = p_date
   WHERE id = p_business_id
     -- uso efectivo de hoy (0 si el contador es de otro día) contra el límite; con p_limit = 0 nunca pasa
     AND (CASE WHEN ai_messages_date = p_date THEN COALESCE(ai_messages_today, 0) ELSE 0 END) < p_limit
  RETURNING ai_messages_today INTO v_count;

  RETURN v_count; -- NULL: límite alcanzado
END;
$$;

REVOKE ALL ON FUNCTION consume_ai_message(uuid, date, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_ai_message(uuid, date, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_ai_message(uuid, date, int) TO service_role;
