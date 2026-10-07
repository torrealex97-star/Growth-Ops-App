-- Ajuste atómico de la comisión de colaborador por venta.
-- Conserva las filas liquidadas y crea un true-up enlazado a la venta; las filas
-- todavía abiertas se recalculan. La función solo es invocable por service_role.
CREATE OR REPLACE FUNCTION public.adjust_sale_collaborator_commission(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_sale_id uuid,
  p_user_id uuid,
  p_target_percent numeric,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_open_count integer := 0;
  v_cancelled_count integer := 0;
  v_paid_net numeric(12,2) := 0;
  v_paid_base_net numeric(12,2) := 0;
  v_target_paid numeric(12,2) := 0;
  v_delta numeric(12,2) := 0;
  v_adjustment_id uuid;
  v_old_percent numeric(5,2);
  v_participant_type text;
BEGIN
  IF p_target_percent < 0 OR p_target_percent > 100 THEN
    RAISE EXCEPTION 'El porcentaje debe estar entre 0 y 100';
  END IF;
  IF length(trim(coalesce(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'El motivo es obligatorio';
  END IF;

  SELECT * INTO v_sale
  FROM public.sales
  WHERE id = p_sale_id AND tenant_id = p_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.commissions
    WHERE tenant_id = p_tenant_id AND sale_id = p_sale_id AND user_id = p_user_id
      AND participant_type IN ('affiliate', 'collaborator')
  ) THEN
    RAISE EXCEPTION 'La venta no está atribuida a este colaborador';
  END IF;

  SELECT
    coalesce(v_sale.affiliate_commission_percent, max(percent)),
    coalesce(max(participant_type) FILTER (WHERE participant_type = 'collaborator'), max(participant_type))
  INTO v_old_percent, v_participant_type
  FROM public.commissions
  WHERE tenant_id = p_tenant_id AND sale_id = p_sale_id AND user_id = p_user_id
    AND participant_type IN ('affiliate', 'collaborator');

  -- Un true-up abierto anterior queda reemplazado por el cálculo nuevo.
  UPDATE public.commissions
  SET status = 'cancelled',
      notes = concat_ws(' · ', notes, 'Sustituido por un ajuste posterior: ' || trim(p_reason)),
      updated_at = now()
  WHERE tenant_id = p_tenant_id AND sale_id = p_sale_id AND user_id = p_user_id
    AND participant_type IN ('affiliate', 'collaborator')
    AND collection_id IS NULL AND refund_id IS NULL
    AND notes LIKE 'Ajuste manual de comisión:%'
    AND status IN ('pending', 'approved');

  -- Las líneas todavía no pagadas se pueden recalcular sin falsear caja.
  UPDATE public.commissions
  SET percent = p_target_percent,
      commission_amount = round(base_amount * p_target_percent / 100, 2),
      status = CASE WHEN p_target_percent = 0 THEN 'cancelled' ELSE status END,
      notes = concat_ws(' · ', notes, 'Ajuste manual: ' || trim(p_reason)),
      updated_at = now()
  WHERE tenant_id = p_tenant_id AND sale_id = p_sale_id AND user_id = p_user_id
    AND participant_type IN ('affiliate', 'collaborator')
    AND NOT (collection_id IS NULL AND refund_id IS NULL AND notes LIKE 'Ajuste manual de comisión:%')
    AND status IN ('pending', 'approved');
  GET DIAGNOSTICS v_open_count = ROW_COUNT;

  SELECT
    coalesce(sum(CASE WHEN direction = 'negative' THEN -commission_amount ELSE commission_amount END), 0),
    coalesce(sum(CASE WHEN direction = 'negative' THEN -base_amount ELSE base_amount END), 0)
  INTO v_paid_net, v_paid_base_net
  FROM public.commissions
  WHERE tenant_id = p_tenant_id AND sale_id = p_sale_id AND user_id = p_user_id
    AND participant_type IN ('affiliate', 'collaborator') AND status = 'liquidated';

  v_target_paid := round(v_paid_base_net * p_target_percent / 100, 2);
  v_delta := round(v_target_paid - v_paid_net, 2);

  IF abs(v_delta) >= 0.01 THEN
    INSERT INTO public.commissions (
      tenant_id, sale_id, collection_id, refund_id, user_id, participant_type,
      percent, base_amount, commission_amount, direction, status,
      liquidation_month, approved_by, notes
    ) VALUES (
      p_tenant_id, p_sale_id, NULL, NULL, p_user_id, v_participant_type,
      p_target_percent, abs(v_paid_base_net), abs(v_delta),
      CASE WHEN v_delta < 0 THEN 'negative' ELSE 'positive' END,
      'pending', to_char(timezone('Europe/Madrid', now()), 'YYYY-MM'), NULL,
      'Ajuste manual de comisión: ' || trim(p_reason)
    ) RETURNING id INTO v_adjustment_id;
  END IF;

  UPDATE public.sales
  SET affiliate_id = p_user_id,
      affiliate_commission_percent = p_target_percent,
      updated_by = p_actor_user_id,
      updated_at = now()
  WHERE id = p_sale_id AND tenant_id = p_tenant_id;

  SELECT count(*) INTO v_cancelled_count
  FROM public.commissions
  WHERE tenant_id = p_tenant_id AND sale_id = p_sale_id AND user_id = p_user_id
    AND participant_type IN ('affiliate', 'collaborator') AND status = 'cancelled';

  INSERT INTO public.audit_logs (
    tenant_id, actor_user_id, entity_type, entity_id, action, old_values, new_values
  ) VALUES (
    p_tenant_id, p_actor_user_id, 'sale_commission', p_sale_id, 'adjust_collaborator_commission',
    jsonb_build_object('user_id', p_user_id, 'percent', v_old_percent, 'paid_net', v_paid_net),
    jsonb_build_object('user_id', p_user_id, 'percent', p_target_percent, 'reason', trim(p_reason),
      'open_rows_updated', v_open_count, 'cancelled_rows', v_cancelled_count,
      'paid_adjustment', v_delta, 'adjustment_id', v_adjustment_id)
  );

  RETURN jsonb_build_object(
    'ok', true, 'openRowsUpdated', v_open_count, 'cancelledRows', v_cancelled_count,
    'paidAdjustment', v_delta, 'adjustmentId', v_adjustment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_sale_collaborator_commission(uuid, uuid, uuid, uuid, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_sale_collaborator_commission(uuid, uuid, uuid, uuid, numeric, text)
  TO service_role;
