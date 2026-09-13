-- El reparto de beneficios entre socios activos no puede superar el 100%.
--
-- Hasta ahora esto solo se avisaba en pantalla (un texto en rojo), que no impide nada: bastaba con
-- ignorarlo, usar otra pestaña o escribir por API para dejar el reparto en 130%. Y un CHECK normal
-- no sirve, porque la regla es sobre la SUMA de varias filas, no sobre una fila aislada.

CREATE OR REPLACE FUNCTION public.partners_check_profit_total()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant UUID := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_total  NUMERIC;
BEGIN
  -- Serializa las escrituras concurrentes de la MISMA subcuenta durante la transacción. Sin este
  -- cerrojo, dos altas simultáneas de 60% leen cada una el total previo (0), las dos ven que caben
  -- y las dos entran: el resultado sería 120% sin que ninguna haya violado la comprobación.
  -- El lock es por tenant, así que no bloquea a otras subcuentas entre sí.
  PERFORM pg_advisory_xact_lock(hashtext('partners_profit:' || v_tenant::text));

  SELECT COALESCE(SUM(profit_percent), 0)
    INTO v_total
    FROM public.partners
   WHERE tenant_id = v_tenant
     AND is_active
     AND id IS DISTINCT FROM NEW.id;  -- excluye la propia fila al actualizarla

  IF NEW.is_active THEN
    v_total := v_total + NEW.profit_percent;
  END IF;

  IF v_total > 100 THEN
    RAISE EXCEPTION
      'El reparto de beneficios activo no puede superar el 100%% (quedaría en %%%)', ROUND(v_total, 2)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS partners_profit_total_guard ON public.partners;
CREATE TRIGGER partners_profit_total_guard
  BEFORE INSERT OR UPDATE ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.partners_check_profit_total();

-- WITH CHECK explícito en la política de escritura. Con FOR ALL, Postgres reutiliza la expresión
-- de USING como WITH CHECK si esta falta, así que el efecto es el mismo — pero dejarlo escrito
-- hace la intención evidente y evita que una edición futura de la política rompa el INSERT sin que
-- nadie lo note.
DROP POLICY IF EXISTS "partners_admin_write" ON public.partners;
CREATE POLICY "partners_admin_write" ON public.partners FOR ALL
  USING (is_admin_or_director())
  WITH CHECK (is_admin_or_director());
