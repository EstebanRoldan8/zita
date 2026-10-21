-- ============================================================================
-- 057 — FK del componente de un set: ON DELETE RESTRICT → NO ACTION
-- Idempotente. Solo cambia la regla de borrado de product_bundle_components.component_product_id.
--
-- Por qué: RESTRICT se revisa en el acto. Al borrar en cascada algo que contiene un set y sus
-- componentes en la misma sentencia (p. ej. borrar un negocio a mano desde Supabase), Postgres puede
-- llegar al componente antes que a la fila que lo referencia y fallar. NO ACTION se revisa al final de
-- la sentencia: sigue impidiendo borrar un componente suelto (la fila del set sigue ahí), pero deja
-- pasar la cascada completa.
--
-- Verificación, autoprueba y rollback: _pruebas/sets/057_*.sql (copia del rollback al final, comentada).
-- ============================================================================
DO $$
DECLARE
  v_name TEXT;
  v_rule "char";
BEGIN
  SELECT c.conname, c.confdeltype INTO v_name, v_rule
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
   WHERE c.conrelid = 'public.product_bundle_components'::regclass
     AND c.contype = 'f'
     AND a.attname = 'component_product_id';

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'No se encontró la FK de product_bundle_components.component_product_id (¿falta la 056?)';
  END IF;

  -- 'r' = RESTRICT; 'a' = NO ACTION. Si ya es NO ACTION no se toca nada.
  IF v_rule <> 'a' THEN
    EXECUTE format('ALTER TABLE public.product_bundle_components DROP CONSTRAINT %I', v_name);
    ALTER TABLE public.product_bundle_components
      ADD CONSTRAINT product_bundle_components_component_product_id_fkey
      FOREIGN KEY (component_product_id) REFERENCES public.products(id) ON DELETE NO ACTION;
  END IF;
END $$;

-- ============================================================================
-- ROLLBACK MANUAL (copia en _pruebas/sets/057_rollback.sql)
-- ============================================================================
-- ALTER TABLE public.product_bundle_components DROP CONSTRAINT IF EXISTS product_bundle_components_component_product_id_fkey;
-- ALTER TABLE public.product_bundle_components
--   ADD CONSTRAINT product_bundle_components_component_product_id_fkey
--   FOREIGN KEY (component_product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
