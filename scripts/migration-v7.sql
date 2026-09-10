-- ============================================================
-- MIGRACIÓN v7 — Duración de agenda, UTM first/last, (facturas/devoluciones = app)
-- Idempotente.
-- ============================================================

-- Agendas: duración de la reunión en minutos
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS duration_minutes INT;

-- Atribución: UTMs de primer contacto (first touch) y último (last touch)
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS first_utm_source TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS first_utm_medium TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS first_utm_campaign TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS first_utm_content TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS first_utm_term TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS last_utm_source TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS last_utm_medium TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS last_utm_campaign TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS last_utm_content TEXT;
ALTER TABLE public.contact_attributions ADD COLUMN IF NOT EXISTS last_utm_term TEXT;

-- ============================================================
-- FIN v7
-- ============================================================
