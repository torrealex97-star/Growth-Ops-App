-- ============================================================
-- v29 — Contratos de ALUMNO con firma nativa + onboarding
--   · contracts: estados extra de tracking (leído, accesos enviados/abiertos)
--     y registro del webhook de onboarding a GoHighLevel.
--   · contract_templates: distinción por `kind` (equipo|alumno) + mensaje de
--     bienvenida configurable ("Bienvenido Winner, acepta las condiciones…").
--   · sales: captura/justificante de pago + plan de pagos personalizado.
--   · Plantilla de contrato de ALUMNO por defecto (mini, con condiciones
--     desplegables) y un plan "personalizado" por producto.
-- El flujo de firma reutiliza la infra nativa (signing_token, PDF a Supabase
-- Storage, hash SHA-256, IP). Al firmar, la app dispara el webhook de accesos.
-- ============================================================

-- ---------- Tracking del contrato / onboarding ----------
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS read_at              TIMESTAMPTZ; -- primera apertura del enlace de firma
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS accesos_enviados_at  TIMESTAMPTZ; -- webhook de onboarding disparado
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS accesos_abiertos_at  TIMESTAMPTZ; -- alumno logueado (fase 2, si GHL lo expone)
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS onboarding_webhook_ok BOOLEAN;    -- resultado del webhook a GHL

-- ---------- Plantillas: tipo + mensaje de bienvenida ----------
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS kind            TEXT NOT NULL DEFAULT 'equipo'; -- 'equipo' | 'alumno'
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS welcome_message TEXT; -- cabecera mostrada al alumno antes de aceptar

-- ---------- Ventas: justificante de pago + plan personalizado ----------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_proof_url TEXT;  -- captura/PDF del pago (Supabase Storage)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS custom_plan       JSONB; -- desglose del plan personalizado

-- ---------- Plantilla de contrato de ALUMNO por defecto ----------
-- Cuerpo legal breve. Las variables {{...}} conocidas se resuelven al generar
-- (empresa/alumno/condiciones) y las del firmante (dni, direccion…) al firmar.
INSERT INTO public.contract_templates (name, kind, role_key, welcome_message, body)
SELECT
  'Contrato de alumno — Academia IA WINNERS',
  'alumno',
  NULL,
  '¡Bienvenido Winner! 🎉 Estás a un clic de entrar en la Academia IA WINNERS. Revisa y acepta las condiciones para recibir tus accesos al instante.',
$tpl$CONTRATO DE FORMACIÓN — ACADEMIA IA WINNERS

REUNIDOS

De una parte, {{empresa}}, con CIF {{cif}}, en adelante "LA ACADEMIA".
De otra parte, {{nombre}}, con DNI/NIE {{dni}} y email {{email}}, en adelante "EL ALUMNO".

Ambas partes se reconocen capacidad legal suficiente y acuerdan lo siguiente.

PRIMERA — OBJETO
La Academia concede al Alumno el acceso al programa formativo "{{producto}}", con una duración de acceso de {{duracion}}, incluyendo los contenidos, comunidad y acompañamiento asociados al mismo.

SEGUNDA — CONDICIONES ECONÓMICAS
El precio del programa y la forma de pago son los detallados en el apartado "CONDICIONES DEL PROGRAMA" de este documento, que forma parte inseparable del presente contrato. El Alumno se compromete al cumplimiento íntegro del plan de pagos acordado.

TERCERA — ACCESO Y NATURALEZA DIGITAL
El Alumno reconoce que el producto es un servicio digital de acceso inmediato. Al firmar el presente contrato y acceder a la plataforma, el Alumno solicita expresamente el inicio de la prestación y comienza a disfrutar del contenido.

CUARTA — DERECHO DE DESISTIMIENTO
De acuerdo con la normativa de consumo, al tratarse de contenido digital cuya ejecución comienza con el consentimiento expreso del Alumno y su acceso inmediato a la plataforma, el Alumno reconoce que decae el derecho de desistimiento una vez iniciado el acceso al contenido.

QUINTA — COMPROMISO DE PAGO
En caso de impago de cualquiera de las cuotas acordadas, La Academia podrá suspender los accesos y reclamar las cantidades pendientes por las vías oportunas, incluyendo la gestión de cobro a través de terceros.

SEXTA — PROPIEDAD INTELECTUAL Y CONFIDENCIALIDAD
Todos los contenidos son propiedad de La Academia. Queda prohibida su reproducción, distribución o cesión a terceros. El Alumno mantendrá la confidencialidad del material y de la comunidad.

SÉPTIMA — PROTECCIÓN DE DATOS
Los datos del Alumno se tratarán conforme al RGPD con la finalidad de gestionar la relación formativa y de pago.

Y en prueba de conformidad, el Alumno acepta las presentes condiciones y firma el contrato de forma electrónica.$tpl$
WHERE NOT EXISTS (
  SELECT 1 FROM public.contract_templates WHERE kind = 'alumno'
);

-- ---------- Plan de pagos PERSONALIZADO por producto ----------
-- Baza para casos a medida (ej. "500€ ahora + resto por Sequra en X meses").
-- El desglose real se guarda por venta en sales.custom_plan; el importe efectivo
-- lo lleva sales.gross_amount. ratio=1 (lo cobrado cuenta como cash collected).
INSERT INTO public.payment_plans (product_id, name, code, gross_price, number_of_payments, method, fee_percent, cash_collection_ratio, sort_order, is_active)
SELECT p.id, 'Plan personalizado', 'CUSTOM', 0, 1, 'custom', 0, 1.00, 999, TRUE
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.payment_plans pp WHERE pp.product_id = p.id AND pp.code = 'CUSTOM'
);

-- ============================================================
-- FIN v29
-- ============================================================
