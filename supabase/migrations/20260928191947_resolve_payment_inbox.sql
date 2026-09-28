-- Service-only transaction. The API verifies Stripe, tenant membership and closer scope first.
-- Advisory lock + existing reference lookup makes retries atomic, including new sale creation.
CREATE OR REPLACE FUNCTION public.resolve_payment_inbox(
  p_tenant uuid, p_actor uuid, p_payment text, p_charge text,
  p_amount numeric, p_fee numeric, p_paid_at timestamptz,
  p_sale_id uuid, p_new_sale jsonb, p_installments jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_sale sales%ROWTYPE; v_collection uuid; v_existing uuid; v_plan payment_plans%ROWTYPE; v_row jsonb; v_review boolean;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_fee IS NULL OR p_fee < 0 OR p_fee > p_amount OR p_paid_at IS NULL OR p_payment IS NULL OR p_payment NOT LIKE 'pi_%' THEN
    RAISE EXCEPTION 'Invalid verified payment';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || p_payment, 0));
  SELECT sale_id, id INTO v_existing, v_collection FROM collections
    WHERE tenant_id = p_tenant AND payment_reference IN (p_payment, p_charge) LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('saleId', v_existing, 'collectionId', v_collection, 'alreadyRecorded', true);
  END IF;
  IF p_sale_id IS NOT NULL THEN
    SELECT * INTO STRICT v_sale FROM sales WHERE id = p_sale_id AND tenant_id = p_tenant FOR UPDATE;
    IF v_sale.status <> 'active' THEN RAISE EXCEPTION 'Sale must be active'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM contacts WHERE id = (p_new_sale->>'contact_id')::uuid AND tenant_id = p_tenant) THEN RAISE EXCEPTION 'Invalid contact'; END IF;
    SELECT * INTO STRICT v_plan FROM payment_plans WHERE id = (p_new_sale->>'payment_plan_id')::uuid AND tenant_id = p_tenant AND is_active;
    IF v_plan.product_id <> (p_new_sale->>'product_id')::uuid THEN RAISE EXCEPTION 'Invalid product/plan'; END IF;
    IF (p_new_sale->>'gross_amount')::numeric < p_amount THEN RAISE EXCEPTION 'Sale cannot be smaller than its first payment'; END IF;
    INSERT INTO sales(tenant_id,contact_id,product_id,payment_plan_id,sale_date,refund_deadline_at,gross_amount,expected_commissionable_amount,closer_id,setter_id,created_by,payment_method,status,down_payment_amount,installments_count,installments_start_date,notes)
    VALUES(p_tenant,(p_new_sale->>'contact_id')::uuid,v_plan.product_id,v_plan.id,(p_new_sale->>'sale_date')::date,(p_new_sale->>'refund_deadline_at')::date,(p_new_sale->>'gross_amount')::numeric,(p_new_sale->>'gross_amount')::numeric*v_plan.cash_collection_ratio,(p_new_sale->>'closer_id')::uuid,(p_new_sale->>'setter_id')::uuid,p_actor,v_plan.method,'active',p_amount,(p_new_sale->>'installments_count')::integer,(p_new_sale->>'installments_start_date')::date,'Registrada desde cobro Stripe ' || p_payment)
    RETURNING * INTO v_sale;
    FOR v_row IN SELECT value FROM jsonb_array_elements(COALESCE(p_installments,'[]'::jsonb)) LOOP
      INSERT INTO sale_expected_installments(tenant_id,sale_id,installment_number,due_date,expected_gross_amount,expected_commissionable_amount,status)
      VALUES(p_tenant,v_sale.id,(v_row->>'installment_number')::integer,(v_row->>'due_date')::date,(v_row->>'expected_gross_amount')::numeric,(v_row->>'expected_commissionable_amount')::numeric,'pending');
    END LOOP;
    INSERT INTO audit_logs(tenant_id,actor_user_id,entity_type,entity_id,action,new_values)
    VALUES(p_tenant,p_actor,'sale',v_sale.id,'create',jsonb_build_object('source','payment_inbox','payment_reference',p_payment));
  END IF;
  IF EXISTS (
    SELECT 1 FROM collections c JOIN sales s ON s.id=c.sale_id AND s.tenant_id=c.tenant_id
    WHERE c.tenant_id=p_tenant AND s.contact_id=v_sale.contact_id
      AND NULLIF(btrim(c.payment_reference),'') IS NULL AND c.status <> 'reversed'
      AND c.gross_amount=p_amount AND abs(extract(epoch FROM (c.collected_at-p_paid_at))) <= 86400
  ) THEN RAISE EXCEPTION 'PENDING_MANUAL_MATCH'; END IF;
  SELECT * INTO STRICT v_plan FROM payment_plans WHERE id=v_sale.payment_plan_id AND tenant_id=p_tenant;
  v_review := (v_plan.method = 'reserva' AND v_sale.reservation_completed_at IS NULL)
    OR (v_plan.method = 'custom' AND EXISTS (SELECT 1 FROM collections WHERE tenant_id=p_tenant AND sale_id=v_sale.id AND is_eligible_for_commission AND status <> 'reversed'));
  v_review := COALESCE(v_review, false);
  INSERT INTO collections(tenant_id,sale_id,collected_at,gross_amount,commissionable_amount,processing_fee,payment_method,payment_provider,payment_reference,is_confirmed,is_eligible_for_commission,needs_commission_review,eligible_at,status)
  VALUES(p_tenant,v_sale.id,p_paid_at,p_amount,round(p_amount*v_plan.cash_collection_ratio,2),p_fee,'stripe','stripe',p_payment,true,NOT v_review,v_review,CASE WHEN NOT v_review THEN now() ELSE NULL END,'collected') RETURNING id INTO v_collection;
  INSERT INTO audit_logs(tenant_id,actor_user_id,entity_type,entity_id,action,new_values)
  VALUES(p_tenant,p_actor,'collection',v_collection,'create',jsonb_build_object('sale_id',v_sale.id,'source','payment_inbox','payment_reference',p_payment));
  RETURN jsonb_build_object('saleId',v_sale.id,'collectionId',v_collection,'alreadyRecorded',false);
END $$;
REVOKE ALL ON FUNCTION public.resolve_payment_inbox(uuid,uuid,text,text,numeric,numeric,timestamptz,uuid,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_payment_inbox(uuid,uuid,text,text,numeric,numeric,timestamptz,uuid,jsonb,jsonb) TO service_role;
