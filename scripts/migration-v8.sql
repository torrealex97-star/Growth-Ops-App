-- ============================================================
-- MIGRACIÓN v8 — Seed de campos KPI para PROSPECCIÓN (outreach)
-- Alimenta el dashboard de Prospección desde kpi_daily_reports (JSONB, sin schema change).
-- Idempotente.
-- ============================================================
DO $$
DECLARE
  r TEXT;
  roles TEXT[] := ARRAY['setter','cold_caller','triager'];
  fields TEXT[][] := ARRAY[
    ['horas','Horas trabajadas'],
    ['leads_asignados','Leads asignados'],
    ['leads_validos','Leads válidos'],
    ['intentos','Intentos de contacto'],
    ['respuestas','Respuestas'],
    ['conversaciones','Conversaciones'],
    ['ofertas','Ofertas'],
    ['citas_agendadas','Citas agendadas'],
    ['depositos','Depósitos']
  ];
  f TEXT[];
  i INT;
BEGIN
  FOREACH r IN ARRAY roles LOOP
    FOR i IN 1 .. array_length(fields,1) LOOP
      f := fields[i:i][1:2];
      INSERT INTO public.kpi_form_templates (role_key, field_key, field_label, field_type, sort_order)
      SELECT r, fields[i][1], fields[i][2], 'number', 10 + i
      WHERE NOT EXISTS (
        SELECT 1 FROM public.kpi_form_templates WHERE role_key = r AND field_key = fields[i][1]
      );
    END LOOP;
  END LOOP;
END $$;
