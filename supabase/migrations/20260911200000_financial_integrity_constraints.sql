-- Auditoría de production-readiness: cierra huecos de integridad de datos financieros
-- confirmados por lectura de código (no solo de schema). Todo aditivo/idempotente, nada
-- destructivo. Usa `NOT VALID` en los CHECK nuevos para no arriesgar que la migración falle
-- si ya existiera algún valor legacy inesperado en producción — validarlos es un paso aparte,
-- deliberado, una vez confirmada la limpieza de datos (ver comentario al final del archivo).

-- ── 1) Doble-cobro: `collections` no tenía ningún UNIQUE de respaldo. El guard actual en
--    app/api/[tenant]/evergreen/payments/mark/route.ts es un SELECT-then-INSERT sin atomicidad
--    (dos requests casi simultáneas — doble clic, webhook reintentado — pueden crear dos filas
--    para la misma cuota). Esta UNIQUE parcial replica exactamente el filtro de ese guard
--    (`expected_installment_id` + `status != 'reversed'`) y lo convierte en una garantía real
--    de base de datos, no solo de aplicación. Las columnas NULL (cobros sin cuota asociada,
--    ej. reservas/entradas manuales) no se ven afectadas — un índice UNIQUE nunca compara NULLs
--    entre sí.
CREATE UNIQUE INDEX IF NOT EXISTS collections_installment_active_key
  ON public.collections (expected_installment_id)
  WHERE expected_installment_id IS NOT NULL AND status != 'reversed';

-- ── 2) Comisiones duplicadas: `commissions` no tenía ningún UNIQUE. `generateCommissionsForCollection`
--    (lib/commissions/generate.ts) inserta como mucho una fila por (collection_id, user_id,
--    participant_type) para la comisión positiva original, y una fila aparte por (refund_id,
--    user_id, participant_type) para el ajuste negativo de un reembolso (esa fila SÍ lleva
--    collection_id heredado además de refund_id — por eso la primera constraint excluye
--    explícitamente refund_id IS NOT NULL, para no chocar con la fila de ajuste del mismo
--    collection_id/user_id/participant_type).
CREATE UNIQUE INDEX IF NOT EXISTS commissions_collection_participant_key
  ON public.commissions (collection_id, user_id, participant_type)
  WHERE collection_id IS NOT NULL AND refund_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS commissions_refund_participant_key
  ON public.commissions (refund_id, user_id, participant_type)
  WHERE refund_id IS NOT NULL;

-- ── 3) appointments_external_id_key seguía siendo UNIQUE GLOBAL entre todos los tenants
--    (se quedó fuera del fix de 20260911170000_tenant_scope_singleton_constraints.sql, que
--    corrigió el mismo patrón en otras 6 tablas). Riesgo: si dos subcuentas reciben citas con
--    el mismo external_id no-UUID (p.ej. IDs correlativos de un CRM externo), una bloquea
--    silenciosamente a la otra en el webhook.
-- Sin WHERE (igual que el índice original): en un UNIQUE normal los NULL de external_id nunca
-- chocan entre sí, así que las citas manuales sin external_id siguen sin verse afectadas. Se
-- deja SIN predicado a propósito (a diferencia de las constraints de comisiones/cobros de más
-- arriba) porque los upserts `onConflict: 'tenant_id,external_id'` de Calendly/GHL necesitan que
-- Postgres pueda inferir esta constraint directamente — un índice parcial no se infiere así
-- desde supabase-js sin repetir su predicado, que la librería no expone.
DROP INDEX IF EXISTS appointments_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS appointments_tenant_external_id_key
  ON public.appointments (tenant_id, external_id);

-- ── 4) Índices faltantes en columnas por las que el código filtra constantemente (dashboard,
--    comisiones, CRM, webhooks) — hoy solo tienen el índice genérico de tenant_id.
CREATE INDEX IF NOT EXISTS sales_contact_id_idx ON public.sales (contact_id);
CREATE INDEX IF NOT EXISTS sales_closer_id_idx ON public.sales (closer_id);
CREATE INDEX IF NOT EXISTS sales_setter_id_idx ON public.sales (setter_id);
CREATE INDEX IF NOT EXISTS sales_status_idx ON public.sales (status);
CREATE INDEX IF NOT EXISTS sales_sale_date_idx ON public.sales (sale_date);

CREATE INDEX IF NOT EXISTS collections_sale_id_idx ON public.collections (sale_id);
CREATE INDEX IF NOT EXISTS collections_status_idx ON public.collections (status);

CREATE INDEX IF NOT EXISTS commissions_sale_id_idx ON public.commissions (sale_id);

CREATE INDEX IF NOT EXISTS sale_expected_installments_sale_id_idx ON public.sale_expected_installments (sale_id);
CREATE INDEX IF NOT EXISTS sale_expected_installments_status_idx ON public.sale_expected_installments (status);

CREATE INDEX IF NOT EXISTS contact_attributions_contact_id_idx ON public.contact_attributions (contact_id);

CREATE INDEX IF NOT EXISTS refunds_sale_id_idx ON public.refunds (sale_id);

-- contacts.email/phone: filtrados en cada webhook de creación de contacto (Calendly, GHL) y en
-- la búsqueda del CRM. lower() porque la búsqueda/matching de email es case-insensitive en la
-- práctica (dos leads con el mismo email en distinta capitalización deben encontrarse).
CREATE INDEX IF NOT EXISTS contacts_email_lower_idx ON public.contacts (lower(email));
CREATE INDEX IF NOT EXISTS contacts_phone_idx ON public.contacts (phone);

-- ── 5) CHECK constraints ausentes en columnas de estado que hoy solo documentan sus valores
--    válidos en un comentario SQL, no en el schema. `en_revision` se añade a expenses.status
--    porque el código (finanzas/gastos-facturas/gastos/page.tsx) ya lo usa aunque nunca se
--    documentó en el DDL original — confirmar SIEMPRE contra el código, no solo el comentario.
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_status_check
  CHECK (status IN ('pagado', 'pendiente', 'en_revision')) NOT VALID;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('activa', 'pausada', 'finalizada')) NOT VALID;

-- ── 6) Comprobante de pago (`sales.payment_proof_url`) se guardaba como una signed URL de 10
--    años (equivale a permanente) en un bucket privado — defeats the purpose. Se añade la
--    columna de PATH para que, a partir de ahora, el detalle de venta pida una signed URL fresca
--    y corta (1h) en el momento de verla en vez de depender de una guardada hace meses/años. Las
--    ventas ya existentes conservan su `payment_proof_url` largo como fallback (no se hace
--    backfill retroactivo: no hay forma de recuperar el path desde una URL firmada ya emitida
--    sin volver a subir el archivo).
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_proof_path TEXT;

-- Los dos CHECK de arriba se añaden NOT VALID a propósito: ya protegen todo INSERT/UPDATE nuevo
-- sin arriesgar que la migración falle si existiera hoy en producción alguna fila con un valor
-- fuera de lista que nadie documentó. Antes de darlos por verificados, correr en el proyecto real:
--   SELECT DISTINCT status FROM expenses  WHERE status NOT IN ('pagado','pendiente','en_revision');
--   SELECT DISTINCT status FROM campaigns WHERE status NOT IN ('activa','pausada','finalizada');
-- Si ambas devuelven 0 filas, validar con:
--   ALTER TABLE public.expenses  VALIDATE CONSTRAINT expenses_status_check;
--   ALTER TABLE public.campaigns VALIDATE CONSTRAINT campaigns_status_check;
