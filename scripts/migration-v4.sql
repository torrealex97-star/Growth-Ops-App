-- ============================================================
-- MIGRACIÓN v4 — IA (facturas, análisis de llamadas), enlace GHL, notas de lead
-- Idempotente.
-- ============================================================

-- --- CONTACTS: ID de GHL para matching fiable del webhook ---
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT;
CREATE INDEX IF NOT EXISTS contacts_ghl_id_idx ON public.contacts(ghl_contact_id);

-- --- APPOINTMENTS: transcripción + análisis IA ---
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS transcript_drive_url TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS transcript_status TEXT; -- pendiente/procesando/listo/error
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_call_score INT;      -- 1-10 calidad de la llamada
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_lead_score INT;      -- 1-10 calidad/temperatura del lead
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_suggested_stage TEXT;-- etapa sugerida por la IA
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_analysis JSONB;      -- objeciones, next steps, etc.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS ai_analyzed_at TIMESTAMPTZ;

-- --- EXPENSES: factura adjunta + extracción IA (borrador para revisar) ---
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS invoice_url TEXT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS ai_extracted JSONB;

-- --- CONTACT NOTES: notas del setter/cold-caller que alimentan el Pipeline ---
CREATE TABLE IF NOT EXISTS public.contact_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id  UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  author_id   UUID REFERENCES public.users(id),
  note        TEXT NOT NULL,
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contact_notes_contact_idx ON public.contact_notes(contact_id);
ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contact_notes_select ON public.contact_notes;
CREATE POLICY contact_notes_select ON public.contact_notes FOR SELECT USING (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS contact_notes_insert ON public.contact_notes;
CREATE POLICY contact_notes_insert ON public.contact_notes FOR INSERT WITH CHECK (get_my_role() IS NOT NULL);
DROP POLICY IF EXISTS contact_notes_update ON public.contact_notes;
CREATE POLICY contact_notes_update ON public.contact_notes FOR UPDATE USING (is_admin_or_director() OR author_id = auth.uid());
DROP POLICY IF EXISTS contact_notes_delete ON public.contact_notes;
CREATE POLICY contact_notes_delete ON public.contact_notes FOR DELETE USING (is_admin_or_director() OR author_id = auth.uid());

-- ============================================================
-- FIN v4
-- ============================================================
