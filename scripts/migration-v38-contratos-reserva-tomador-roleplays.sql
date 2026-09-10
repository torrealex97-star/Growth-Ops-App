-- ============================================================
-- v38 — Reunión socios 2026-07-10
--   (2) Contrato de RESERVA: envía solo el contrato de reserva (sin accesos)
--       y añade una fase propia "contrato de reserva enviado/firmado".
--   (3) Plantillas de contrato asociadas a un MÉTODO DE PAGO: se elige la
--       plantilla del método seleccionado al generar el contrato del alumno.
--   (4) TOMADOR ≠ alumno: el comprador puede ser distinto de quien agenda
--       (madre / empresa / Sequra). Se guardan sus datos, se decide a qué
--       email van los accesos y se genera un contrato de tomador aparte.
--   (7) ROLEPLAYS en la biblioteca de llamadas (material de entrenamiento).
-- ============================================================

-- ---------- (3) Plantillas por método de pago + tipo tomador ----------
-- payment_method: null = plantilla por defecto (cualquier método). Valores:
--   'reserva' | 'sequra' | 'autofinanciado' | 'transferencia' | 'stripe' | 'full_pay' | 'custom'
ALTER TABLE public.contract_templates ADD COLUMN IF NOT EXISTS payment_method TEXT;

-- ---------- (2) Marca el contrato como de reserva (no dispara accesos) ----------
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS is_reservation BOOLEAN NOT NULL DEFAULT FALSE;
-- Distingue el contrato del ALUMNO del contrato del TOMADOR dentro de una misma venta.
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS contract_party TEXT NOT NULL DEFAULT 'alumno'; -- 'alumno' | 'tomador'

-- ---------- (4) Tomador (comprador) distinto del agendador ----------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS buyer_is_scheduler BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payer_data  JSONB;  -- {name,dni,email,phone,address,city,relation}
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS access_email TEXT;   -- email al que se envían los accesos (null = email del contacto)

-- ---------- (7) Roleplays ----------
CREATE TABLE IF NOT EXISTS public.roleplays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  participant_id UUID REFERENCES public.users(id),      -- quién hizo el roleplay
  participant_name TEXT,                                 -- nombre libre si no es usuario
  recording_url TEXT,                                    -- enlace de la grabación
  transcript_url TEXT,                                   -- enlace de la transcripción (Drive, etc.)
  transcript TEXT,                                       -- o texto pegado
  score NUMERIC,                                         -- nota del roleplay (0-10)
  notes TEXT,
  shared BOOLEAN NOT NULL DEFAULT TRUE,                  -- visible para el equipo
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.roleplays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roleplays_select ON public.roleplays;
CREATE POLICY roleplays_select ON public.roleplays FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS roleplays_admin ON public.roleplays;
CREATE POLICY roleplays_admin ON public.roleplays FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

-- ---------- Plantilla de contrato de TOMADOR por defecto ----------
-- El tomador (p.ej. la madre o una empresa) financia/paga la formación de otra
-- persona. Contrato de garantía de pago, más agresivo (avala el pago).
INSERT INTO public.contract_templates (name, kind, role_key, payment_method, welcome_message, body)
SELECT
  'Contrato de tomador — financiación de un tercero',
  'tomador',
  NULL,
  NULL,
  'Estás a punto de aceptar las condiciones como TOMADOR/PAGADOR de la formación. Revisa y acepta para dejar el pago comprometido.',
$tpl$CONTRATO DE PRESTACIÓN Y PAGO POR TERCERO — ACADEMIA DEMO

REUNIDOS

De una parte, {{empresa}}, con CIF {{cif}}, en adelante "LA ACADEMIA".
De otra parte, {{nombre}}, con DNI/NIE {{dni}} y email {{email}}, en adelante "EL TOMADOR/PAGADOR", que asume el pago de la formación del alumno indicado en las condiciones.

Ambas partes se reconocen capacidad legal suficiente y acuerdan lo siguiente.

PRIMERA — OBJETO
El Tomador asume el pago del programa "{{producto}}" contratado para el alumno beneficiario, según el importe y la forma de pago detallados en el apartado "CONDICIONES DEL PROGRAMA".

SEGUNDA — OBLIGACIÓN DE PAGO
El Tomador se obliga al pago íntegro del plan acordado. En caso de impago de cualquier cuota, La Academia podrá reclamar las cantidades pendientes al Tomador por las vías oportunas, incluyendo la gestión de cobro a través de terceros.

TERCERA — NATURALEZA DIGITAL Y DESISTIMIENTO
Al tratarse de contenido digital cuya ejecución comienza con el acceso inmediato del alumno a la plataforma, decae el derecho de desistimiento una vez iniciado dicho acceso.

CUARTA — PROTECCIÓN DE DATOS
Los datos del Tomador se tratarán conforme al RGPD con la finalidad de gestionar el pago y la facturación de la formación.

Y en prueba de conformidad, el Tomador acepta las presentes condiciones y firma el contrato de forma electrónica.$tpl$
WHERE NOT EXISTS (
  SELECT 1 FROM public.contract_templates WHERE kind = 'tomador'
);

-- ============================================================
-- FIN v38
-- ============================================================
