-- SEGURIDAD P0 — FUGA ENTRE SUBCUENTAS en stripe_payments y knowledge_chunks. [YA APLICADA el 4-oct, con OK de Alex]
--
-- QUÉ PASA (medido en producción el 4-oct, transacción de solo lectura revertida). Un usuario con
-- rol `admin` que NO es miembro de WDC lee los 83 pagos de Stripe de WDC (importes, correos), mientras
-- que sus ventas salen correctamente en 0. Todas las demás tablas con tenant_id tienen una política
-- RESTRICTIVE de aislamiento; estas dos son las únicas que no, y sus políticas permisivas conceden
-- acceso a `is_admin_or_director()` SIN mirar la subcuenta:
--   · stripe_payments_all  (cmd ALL → lectura Y escritura)
--   · kc_select / kc_update / kc_delete sobre knowledge_chunks
-- Quien administra otra subcuenta puede, por tanto, leer —y por la forma de la política, también
-- modificar o borrar— datos de la de un cliente.
--
-- QUÉ HACE. Añade a las dos tablas la misma política restrictiva que ya usan sales, collections,
-- contacts…: pertenecer a la subcuenta de la fila, o ser super admin de la plataforma. Las políticas
-- RESTRICTIVE se combinan con AND: no abren nada, solo cierran lo que cruce de subcuenta. El
-- service-role (rutas de servidor, crons, webhooks) no pasa por RLS y no se ve afectado.
--
-- COMPROBADO ANTES DE ESCRIBIRLA: knowledge_chunks tiene 180 filas, ninguna sin subcuenta (no hay
-- conocimiento «global» que esta política pudiera esconder); stripe_payments, 83 filas, todas con
-- subcuenta.

CREATE POLICY stripe_payments_tenant_isolation ON public.stripe_payments
  AS RESTRICTIVE
  FOR ALL
  USING ((tenant_id IN (SELECT auth_tenant_ids())) OR is_super_admin());

CREATE POLICY knowledge_chunks_tenant_isolation ON public.knowledge_chunks
  AS RESTRICTIVE
  FOR ALL
  USING ((tenant_id IN (SELECT auth_tenant_ids())) OR is_super_admin());

-- VERIFICADO EN PRODUCCIÓN tras aplicarla (4-oct): admin miembro de la subcuenta, 83 pagos y 90
-- fragmentos (los suyos, sin pérdida); admin que NO es miembro, de 83 pagos a 0 y 0 fragmentos;
-- super admin, 83 y 180 (todo). Registrada en schema_migrations con la versión de este fichero.
