-- SEGURIDAD P0 — continuación de F01 (ver migración 20261003120000). La propia migración
-- anterior dejaba `stripe_payments_select_team` fuera a propósito porque esta tabla no tiene
-- columna de atribución individual (ni setter_id/closer_id ni vínculo directo a
-- collaborator_profiles): hasta ahora, cualquier miembro del tenant veía TODOS los pagos de
-- Stripe del tenant (`tenant_id IN auth_tenant_ids()` sin más condición), incluyendo email y
-- monto de clientes ajenos.
--
-- El vínculo existe de forma indirecta: `collections.payment_reference` coincide con
-- `stripe_payments.payment_id`/`charge_id` en la mayoría de pagos reconciliados (61 de 83 en
-- producción al momento de este fix; los que no coinciden son pagos sin cobro interno todavía,
-- el hueco que `pagosSinCobro` de Data Health ya señala — correcto que solo liderazgo los vea,
-- es trabajo de reconciliación). `app/[tenant]/dashboard/page.tsx:514-517` YA filtra así en
-- JavaScript cuando el usuario está autoscoped (`cashInputs`: solo cuenta pagos de Stripe cuya
-- referencia aparece en sus propias `collections`) — es decir, la app ya asumía que RLS hacía
-- este trabajo. No lo hacía: el navegador recibía los 83 pagos completos (incluidos email y
-- monto de clientes de otros vendedores) y el filtrado ocurría solo al pintar, no en la red.
--
-- Fix: añade la misma condición de atribución que ya usan `sales`/`collections` (vía
-- `is_my_collaborator_sale`, `setter_id`/`closer_id` de la venta ligada por `payment_reference`),
-- reutilizando `is_team_scope_allowed()` de la migración anterior para quien tenga
-- `data_scope='team'` y rol de liderazgo. Verificado con dry-run y en real contra el mismo
-- afiliado de la migración anterior: de 83 pagos visibles a 30 — exactamente los que su propia
-- atribución de colaborador explica (comprobado con un JOIN directo sales/collections/
-- contact_attributions/collaborator_profiles con service role, mismo número).

ALTER POLICY stripe_payments_select_team ON public.stripe_payments
  USING (
    is_super_admin()
    OR (
      tenant_id IN (SELECT auth_tenant_ids())
      AND (
        is_admin_or_director()
        OR is_team_scope_allowed()
        OR EXISTS (
          SELECT 1
          FROM public.collections c
          JOIN public.sales s ON s.id = c.sale_id
          WHERE (c.payment_reference = stripe_payments.payment_id OR c.payment_reference = stripe_payments.charge_id)
            AND (s.setter_id = auth.uid() OR s.closer_id = auth.uid() OR is_my_collaborator_sale(s.id))
        )
      )
    )
  );
