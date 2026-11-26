-- ============================================================================
-- 068 — Edición completa de pedidos: historial (order_edits) y guardado atómico.
-- Solo aditivo e idempotente: no cambia ninguna tabla ni función existente.
--
--  order_edits   una fila por campo cambiado (quién, cuándo, campo, antes → después). Las filas de un mismo
--                guardado comparten edit_group. El dueño solo LEE las de su negocio; escribe solo el backend.
--  edit_order    aplica en UNA transacción el plan que arma el backend (services/orderEdit.js):
--                  1. bloquea el pedido (FOR UPDATE) y comprueba que no cambió desde la vista previa;
--                  2. mueve el stock por la diferencia con adjust_stock (si falta stock, aborta TODO);
--                  3. actualiza, borra o agrega order_items (conserva los ids y bundle_snapshot de las líneas que quedan);
--                  4. actualiza el pedido (nunca su id: el número P-XXXXXXXX sale del id);
--                  5. ajusta el ingreso y el egreso de costo del pedido EN SU FILA (índices únicos de 053: sin duplicar);
--                  6. guarda el historial.
--                Cualquier error en cualquier paso revierte todos los pasos.
--  reopen_order  reabre un pedido cancelado (vuelve a descontar su stock y, si estaba pagado, su Caja) usando edit_order.
-- Ambas funciones: SECURITY DEFINER y EXECUTE solo para service_role (el backend). p_business_id siempre viene del JWT.
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_edits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  edit_group    UUID NOT NULL,
  user_id       UUID,
  source        TEXT NOT NULL DEFAULT 'panel',
  field         TEXT NOT NULL,
  before_value  JSONB,
  after_value   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_edits_source_check') THEN
    ALTER TABLE order_edits ADD CONSTRAINT order_edits_source_check CHECK (source IN ('panel', 'asistente'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_edits_order ON order_edits (business_id, order_id, created_at DESC);

ALTER TABLE order_edits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_edits' AND policyname = 'owner_order_edits_read') THEN
    CREATE POLICY owner_order_edits_read ON order_edits
      FOR SELECT USING (business_id = get_business_id_for_user(auth.uid()));
  END IF;
END $$;

-- ── edit_order ──────────────────────────────────────────────────────────────
-- p_expected: { status, payment_status, total_amount, items_count, items_qty, items_sum } leídos al armar el plan
-- p_order:    solo las columnas que cambian (lista blanca abajo)
-- p_items:    NULL = no se tocan; si no, la lista FINAL: con "id" = línea existente (cantidad, precio, variante,
--             descripción), sin "id" = línea nueva; las que no vienen se borran
-- p_stock:    [{ product_id, variant_id, change, type: 'venta'|'devolucion', label }]
-- p_cash:     { income: { op: 'none'|'set'|'delete', amount, date, description, client_id }, expense: { ... } }
-- p_edits:    [{ field, before, after }]
CREATE OR REPLACE FUNCTION edit_order(
  p_business_id UUID, p_order_id UUID, p_expected JSONB, p_order JSONB, p_items JSONB,
  p_stock JSONB, p_cash JSONB, p_edits JSONB,
  p_user UUID DEFAULT NULL, p_source TEXT DEFAULT 'panel', p_ref_type TEXT DEFAULT 'order_edit'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order  orders%ROWTYPE;
  v_cnt    INT;
  v_qty    BIGINT;
  v_sum    NUMERIC;
  v_ids    INT;
  v_match  INT;
  v_move   JSONB;
  v_inc    JSONB := COALESCE(p_cash->'income', '{}'::jsonb);
  v_exp    JSONB := COALESCE(p_cash->'expense', '{}'::jsonb);
  v_o      JSONB := COALESCE(p_order, '{}'::jsonb);
  v_group  UUID := gen_random_uuid();
BEGIN
  IF p_ref_type NOT IN ('order_edit', 'order_reopen') THEN
    RAISE EXCEPTION 'REFERENCIA_INVALIDA';
  END IF;

  -- 1. Pedido del negocio, bloqueado hasta el final de la transacción
  SELECT * INTO v_order FROM orders WHERE id = p_order_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PEDIDO_NO_ENCONTRADO';
  END IF;

  IF jsonb_typeof(p_expected) = 'object' THEN  -- NULL o JSON null = sin comprobación
    SELECT COUNT(*), COALESCE(SUM(quantity), 0), COALESCE(SUM(total_price), 0)
      INTO v_cnt, v_qty, v_sum
      FROM order_items WHERE order_id = p_order_id AND business_id = p_business_id;
    IF COALESCE(v_order.status, '') IS DISTINCT FROM COALESCE(p_expected->>'status', '')
       OR COALESCE(v_order.payment_status, 'pendiente') IS DISTINCT FROM COALESCE(p_expected->>'payment_status', 'pendiente')
       OR COALESCE(v_order.total_amount, 0) <> COALESCE((p_expected->>'total_amount')::numeric, 0)
       OR v_cnt <> COALESCE((p_expected->>'items_count')::int, -1)
       OR v_qty <> COALESCE((p_expected->>'items_qty')::bigint, -1)
       OR v_sum <> COALESCE((p_expected->>'items_sum')::numeric, -1) THEN
      RAISE EXCEPTION 'PEDIDO_MODIFICADO';
    END IF;
  END IF;

  -- 2. Stock por la diferencia (adjust_stock nunca deja negativo y deja el movimiento enlazado al pedido)
  FOR v_move IN SELECT value FROM jsonb_array_elements(COALESCE(p_stock, '[]'::jsonb)) LOOP
    IF (v_move->>'type') NOT IN ('venta', 'devolucion') THEN
      RAISE EXCEPTION 'MOVIMIENTO_INVALIDO';
    END IF;
    BEGIN
      PERFORM adjust_stock(
        p_business_id, (v_move->>'product_id')::uuid, NULLIF(v_move->>'variant_id', '')::uuid,
        (v_move->>'change')::int, v_move->>'type', 'Edición de pedido', p_ref_type, p_order_id, p_user
      );
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM = 'STOCK_INSUFICIENTE_O_NO_ENCONTRADO' THEN
        RAISE EXCEPTION 'STOCK_INSUFICIENTE: %', COALESCE(v_move->>'label', 'un artículo');
      END IF;
      RAISE;
    END;
  END LOOP;

  -- 3. Líneas del pedido
  IF jsonb_typeof(p_items) = 'array' THEN  -- NULL o JSON null = las líneas no se tocan
    -- Toda línea con id debe ser de ESTE pedido
    SELECT COUNT(*) INTO v_ids FROM jsonb_array_elements(p_items) AS t(i) WHERE NULLIF(i->>'id', '') IS NOT NULL;
    SELECT COUNT(*) INTO v_match
      FROM jsonb_array_elements(p_items) AS t(i)
      JOIN order_items oi ON oi.id = NULLIF(i->>'id', '')::uuid AND oi.order_id = p_order_id AND oi.business_id = p_business_id;
    IF v_ids <> v_match THEN
      RAISE EXCEPTION 'LINEA_INVALIDA';
    END IF;

    DELETE FROM order_items oi
     WHERE oi.order_id = p_order_id AND oi.business_id = p_business_id
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) AS t(i) WHERE NULLIF(i->>'id', '')::uuid = oi.id);

    UPDATE order_items oi
       SET quantity    = (i->>'quantity')::int,
           unit_price  = (i->>'unit_price')::numeric,
           total_price = (i->>'quantity')::int * (i->>'unit_price')::numeric,
           variant_id  = NULLIF(i->>'variant_id', '')::uuid,
           description = i->>'description'
      FROM jsonb_array_elements(p_items) AS t(i)
     WHERE oi.id = NULLIF(i->>'id', '')::uuid AND oi.order_id = p_order_id AND oi.business_id = p_business_id;

    INSERT INTO order_items (order_id, business_id, product_id, variant_id, description, quantity, unit_price, total_price, bundle_snapshot)
    SELECT p_order_id, p_business_id, NULLIF(i->>'product_id', '')::uuid, NULLIF(i->>'variant_id', '')::uuid, i->>'description',
           (i->>'quantity')::int, (i->>'unit_price')::numeric, (i->>'quantity')::int * (i->>'unit_price')::numeric,
           CASE WHEN jsonb_typeof(i->'bundle_snapshot') = 'object' THEN i->'bundle_snapshot' ELSE NULL END
      FROM jsonb_array_elements(p_items) AS t(i)
     WHERE NULLIF(i->>'id', '') IS NULL;
  END IF;

  -- 4. Pedido (lista blanca de columnas; id, business_id y source nunca cambian)
  UPDATE orders SET
    client_name      = CASE WHEN v_o ? 'client_name'      THEN v_o->>'client_name'      ELSE client_name END,
    client_phone     = CASE WHEN v_o ? 'client_phone'     THEN v_o->>'client_phone'     ELSE client_phone END,
    customer_email   = CASE WHEN v_o ? 'customer_email'   THEN v_o->>'customer_email'   ELSE customer_email END,
    delivery_type    = CASE WHEN v_o ? 'delivery_type'    THEN v_o->>'delivery_type'    ELSE delivery_type END,
    delivery_address = CASE WHEN v_o ? 'delivery_address' THEN v_o->>'delivery_address' ELSE delivery_address END,
    shipping_city    = CASE WHEN v_o ? 'shipping_city'    THEN v_o->>'shipping_city'    ELSE shipping_city END,
    notes            = CASE WHEN v_o ? 'notes'            THEN v_o->>'notes'            ELSE notes END,
    shipping_carrier = CASE WHEN v_o ? 'shipping_carrier' THEN v_o->>'shipping_carrier' ELSE shipping_carrier END,
    tracking_code    = CASE WHEN v_o ? 'tracking_code'    THEN v_o->>'tracking_code'    ELSE tracking_code END,
    status           = CASE WHEN v_o ? 'status'           THEN v_o->>'status'           ELSE status END,
    payment_status   = CASE WHEN v_o ? 'payment_status'   THEN v_o->>'payment_status'   ELSE payment_status END,
    payment_method   = CASE WHEN v_o ? 'payment_method'   THEN v_o->>'payment_method'   ELSE payment_method END,
    paid_at          = CASE WHEN v_o ? 'paid_at'          THEN NULLIF(v_o->>'paid_at', '')::timestamptz ELSE paid_at END,
    shipping_zone    = CASE WHEN v_o ? 'shipping_zone'    THEN v_o->>'shipping_zone'    ELSE shipping_zone END,
    shipping_cost    = CASE WHEN v_o ? 'shipping_cost'    THEN (v_o->>'shipping_cost')::numeric   ELSE shipping_cost END,
    discount_amount  = CASE WHEN v_o ? 'discount_amount'  THEN (v_o->>'discount_amount')::numeric ELSE discount_amount END,
    total_amount     = CASE WHEN v_o ? 'total_amount'     THEN (v_o->>'total_amount')::numeric    ELSE total_amount END,
    created_at       = CASE WHEN v_o ? 'created_at'       THEN (v_o->>'created_at')::timestamptz  ELSE created_at END,
    updated_at       = now()
  WHERE id = p_order_id AND business_id = p_business_id;

  -- 5. Caja del pedido: se ajusta la MISMA fila (conserva su fecha original); solo se crea si no existe
  IF v_inc->>'op' = 'set' THEN
    UPDATE income SET amount = (v_inc->>'amount')::numeric
     WHERE order_id = p_order_id AND business_id = p_business_id;
    IF NOT FOUND THEN
      INSERT INTO income (business_id, amount, category, source, description, date, client_id, order_id)
      VALUES (p_business_id, (v_inc->>'amount')::numeric, 'productos', 'order', v_inc->>'description',
              (v_inc->>'date')::date, NULLIF(v_inc->>'client_id', '')::uuid, p_order_id);
    END IF;
  ELSIF v_inc->>'op' = 'delete' THEN
    DELETE FROM income WHERE order_id = p_order_id AND business_id = p_business_id;
  END IF;

  IF v_exp->>'op' = 'set' THEN
    UPDATE expenses SET amount = (v_exp->>'amount')::numeric
     WHERE order_id = p_order_id AND business_id = p_business_id;
    IF NOT FOUND THEN
      INSERT INTO expenses (business_id, amount, category, description, date, order_id)
      VALUES (p_business_id, (v_exp->>'amount')::numeric, 'productos', v_exp->>'description', (v_exp->>'date')::date, p_order_id);
    END IF;
  ELSIF v_exp->>'op' = 'delete' THEN
    DELETE FROM expenses WHERE order_id = p_order_id AND business_id = p_business_id;
  END IF;

  -- 6. Historial
  INSERT INTO order_edits (business_id, order_id, edit_group, user_id, source, field, before_value, after_value)
  SELECT p_business_id, p_order_id, v_group, p_user, COALESCE(p_source, 'panel'), e->>'field', e->'before', e->'after'
    FROM jsonb_array_elements(COALESCE(p_edits, '[]'::jsonb)) AS t(e);

  RETURN jsonb_build_object('edit_group', v_group);
END $$;

REVOKE ALL ON FUNCTION edit_order(UUID, UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION edit_order(UUID, UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, UUID, TEXT, TEXT) TO service_role;

-- ── reopen_order ────────────────────────────────────────────────────────────
-- Solo un pedido cancelado; p_stock trae los movimientos 'venta' de todas sus líneas y p_cash su Caja si estaba pagado
CREATE OR REPLACE FUNCTION reopen_order(
  p_business_id UUID, p_order_id UUID, p_new_status TEXT, p_expected JSONB,
  p_stock JSONB, p_cash JSONB, p_edits JSONB,
  p_user UUID DEFAULT NULL, p_source TEXT DEFAULT 'panel'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF p_new_status NOT IN ('recibido', 'en_proceso', 'listo', 'enviado', 'entregado') THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO';
  END IF;
  SELECT status INTO v_status FROM orders WHERE id = p_order_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PEDIDO_NO_ENCONTRADO';
  END IF;
  IF v_status IS DISTINCT FROM 'cancelado' THEN
    RAISE EXCEPTION 'PEDIDO_NO_CANCELADO';
  END IF;
  RETURN edit_order(p_business_id, p_order_id, p_expected, jsonb_build_object('status', p_new_status), NULL,
                    p_stock, p_cash, p_edits, p_user, p_source, 'order_reopen');
END $$;

REVOKE ALL ON FUNCTION reopen_order(UUID, UUID, TEXT, JSONB, JSONB, JSONB, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reopen_order(UUID, UUID, TEXT, JSONB, JSONB, JSONB, JSONB, UUID, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFICACIÓN:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'order_edits';
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'order_edits';                      -- true
-- SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('edit_order', 'reopen_order');  -- prosecdef = true
-- SELECT has_function_privilege('authenticated', 'edit_order(uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,uuid,text,text)', 'EXECUTE'); -- false
--
-- ROLLBACK (solo si hace falta deshacer; se pierde el historial de ediciones; los pedidos editados quedan como están):
-- DROP FUNCTION IF EXISTS reopen_order(UUID, UUID, TEXT, JSONB, JSONB, JSONB, JSONB, UUID, TEXT);
-- DROP FUNCTION IF EXISTS edit_order(UUID, UUID, JSONB, JSONB, JSONB, JSONB, JSONB, JSONB, UUID, TEXT, TEXT);
-- DROP TABLE IF EXISTS order_edits;
-- NOTIFY pgrst, 'reload schema';
