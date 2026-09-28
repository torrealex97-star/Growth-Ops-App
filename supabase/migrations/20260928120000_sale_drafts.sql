-- VENTAS BORRADOR (sugeridas desde Stripe, pendientes de aprobación).
--
-- POR QUÉ EXISTE. El webhook de Stripe (app/api/[tenant]/evergreen/webhooks/stripe) ya identifica
-- a qué contacto pertenece un pago (por email) pero NUNCA crea la venta sola: `sales.product_id` y
-- `sales.payment_plan_id` son NOT NULL y un pago de Stripe no dice a cuál corresponden — inventarlo
-- fue justo el incidente que dejó 48 ventas para 27 clientas (PR #211, ver lib/finance/stripeImport.ts).
-- Esta tabla es el punto medio: el pago SÍ se identifica y se sugiere automáticamente en tiempo real,
-- pero sigue esperando que un closer o admin confirme qué venta y qué plan es antes de escribir nada
-- en `sales`/`collections`. Aprobar una fila de aquí es lo único que puede crear una venta o un cobro.
--
-- QUÉ SUGIERE, POR ORDEN DE CONFIANZA (nunca se inventa nada — ver lib/finance/stripeSaleDrafts.ts):
--   1. Venta activa ya existente del mismo contacto → se sugiere que este pago es una CUOTA de esa
--      venta (existing_sale_id): el producto/plan ya los decidió una persona antes, no se adivinan.
--   2. El PRODUCTO DE STRIPE (Price ID) del pago está mapeado en `stripe_price_map` → el mapeo lo
--      creó una persona una vez en Integraciones; a partir de ahí cada pago con ese Price ID se
--      resuelve solo, con la misma fiabilidad que si lo hubiera tecleado un admin.
--   3. Sin venta previa ni mapeo: se sugiere un plan solo cuando su `gross_price` (pago único) o
--      `gross_price / number_of_payments` (cuota) coincide exactamente con el importe Y es el ÚNICO
--      plan activo del tenant que coincide; con cero o más de un candidato, queda sin sugerencia y el
--      admin elige a mano — la ambigüedad nunca se resuelve por adivinanza.
CREATE TABLE public.sale_drafts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES public.tenants(id),
  status                    TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Origen fijo a 'stripe' hoy; el nombre queda abierto por si mañana entra otra pasarela.
  source                    TEXT NOT NULL DEFAULT 'stripe',
  -- El PaymentIntent (evento canónico del dinero, ver lib/stripe/webhook.ts). Es la clave de
  -- idempotencia: el mismo pago no puede generar dos borradores ni, tras aprobarse, poder reprocesarse.
  payment_reference         TEXT NOT NULL,
  amount                    NUMERIC NOT NULL,
  currency                  TEXT NOT NULL DEFAULT 'EUR',
  contact_id                UUID REFERENCES public.contacts(id),
  email                     TEXT,
  occurred_at               TIMESTAMPTZ NOT NULL,
  -- Sugerencias: nunca se escriben en `sales` hasta que alguien aprueba. Ambas pueden ir null si no
  -- hubo forma segura de sugerir nada (el admin las rellena al aprobar).
  suggested_product_id      UUID REFERENCES public.products(id),
  suggested_payment_plan_id UUID REFERENCES public.payment_plans(id),
  -- Si el pago parece una cuota de una venta ya existente del mismo contacto, en vez de una venta
  -- nueva: aprobar esta fila crea un COBRO sobre esa venta, no una venta nueva.
  existing_sale_id          UUID REFERENCES public.sales(id),
  -- Por qué se sugirió lo que se sugirió (o por qué no se sugirió nada). Texto libre para el admin.
  reason                    TEXT,
  -- Rellenos al aprobar/rechazar. La venta o el cobro que resultó de esta fila queda enlazado aquí
  -- para poder auditar de dónde salió sin tener que adivinarlo por fecha/importe.
  approved_sale_id          UUID REFERENCES public.sales(id),
  reviewed_by               UUID REFERENCES public.users(id),
  reviewed_at               TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- El Price ID de Stripe del pago, cuando el evento lo trae (facturas de suscripción/cuotas —
  -- ver lib/stripe/webhook.ts). Un pago único sin factura puede no traerlo: queda NULL y la
  -- sugerencia cae al emparejamiento por importe.
  stripe_price_id           TEXT,
  -- El mismo pago nunca genera dos borradores, ni siquiera si el webhook lo entrega dos veces.
  UNIQUE (tenant_id, payment_reference)
);

CREATE INDEX sale_drafts_tenant_status_idx ON public.sale_drafts(tenant_id, status, created_at DESC);

-- MAPEO PRICE ID → PRODUCTO/PLAN, configurado UNA VEZ por un admin (Integraciones). Es la decisión
-- humana que permite reconocer automáticamente qué vende cada Price de Stripe sin adivinarlo por
-- importe: mismo espíritu que elegir producto/plan en el registro manual, pero decidido de antemano
-- y reutilizado por cada pago futuro con ese Price ID.
CREATE TABLE public.stripe_price_map (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id),
  stripe_price_id   TEXT NOT NULL,
  product_id        UUID NOT NULL REFERENCES public.products(id),
  payment_plan_id   UUID NOT NULL REFERENCES public.payment_plans(id),
  created_by        UUID NOT NULL REFERENCES public.users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, stripe_price_id)
);

ALTER TABLE public.stripe_price_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stripe_price_map_select_finance" ON public.stripe_price_map FOR SELECT
  USING (public.is_admin_or_director());
CREATE POLICY "stripe_price_map_write_finance" ON public.stripe_price_map FOR ALL
  USING (public.is_admin_or_director()) WITH CHECK (public.is_admin_or_director());

CREATE POLICY "stripe_price_map_tenant_isolation" ON public.stripe_price_map AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

COMMENT ON TABLE public.stripe_price_map IS
  'Qué producto/plan interno corresponde a cada Price ID de Stripe, decidido una vez por un admin. Usado para sugerir ventas borrador sin adivinar por importe.';

-- PISTAS DE PRICE ID POR PAYMENT INTENT, para cuando el evento de factura (que trae el Price ID)
-- llega ANTES o DESPUÉS que el payment_intent.succeeded (Stripe no garantiza el orden). Vida corta:
-- solo sirve para enlazar el borrador recién creado o por crear con su Price ID; no es dato de
-- negocio y no necesita RLS de lectura para el equipo (solo lo usa el webhook, con service role).
CREATE TABLE public.stripe_price_hints (
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id),
  payment_intent_id   TEXT NOT NULL,
  stripe_price_id     TEXT NOT NULL,
  seen_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, payment_intent_id)
);

ALTER TABLE public.stripe_price_hints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stripe_price_hints_service_only" ON public.stripe_price_hints AS RESTRICTIVE FOR ALL
  USING (false) WITH CHECK (false);

COMMENT ON TABLE public.stripe_price_hints IS
  'Tabla técnica de corta vida: enlaza el Price ID visto en invoice.payment_succeeded con su PaymentIntent cuando los eventos de Stripe llegan desordenados. Solo la usa el webhook (service role).';

ALTER TABLE public.sale_drafts ENABLE ROW LEVEL SECURITY;

-- Solo quien puede escribir ventas/comisiones puede ver o resolver un borrador: aprobar una fila
-- escribe en `sales`/`collections`, así que el permiso de lectura ya implica el de escritura de dinero.
CREATE POLICY "sale_drafts_select_finance" ON public.sale_drafts FOR SELECT
  USING (public.is_admin_or_director());
CREATE POLICY "sale_drafts_update_finance" ON public.sale_drafts FOR UPDATE
  USING (public.is_admin_or_director());

CREATE POLICY "sale_drafts_tenant_isolation" ON public.sale_drafts AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

COMMENT ON TABLE public.sale_drafts IS
  'Pagos de Stripe identificados por contacto pero pendientes de que un closer/admin confirme la venta y el plan antes de escribir en sales/collections.';
