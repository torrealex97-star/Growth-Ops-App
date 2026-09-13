-- Observabilidad de coste del agente de IA: hasta ahora no se registraba NADA de consumo (ni
-- tokens, ni coste, ni latencia), así que no había forma de saber lo que cuesta una conversación
-- ni de detectar una que se desmadre. Se guarda en el mensaje del asistente (que es la unidad que
-- provoca el gasto) en vez de en una tabla nueva, para no duplicar el ciclo de vida ni las RLS.
ALTER TABLE public.ai_messages
  ADD COLUMN IF NOT EXISTS model          TEXT,
  ADD COLUMN IF NOT EXISTS input_tokens   INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS cache_read_tokens  INTEGER,
  ADD COLUMN IF NOT EXISTS cache_write_tokens INTEGER,
  -- NULL a propósito cuando el modelo no está tarifado: un 0 falso en un informe de costes
  -- engaña más que un hueco (ver lib/ai/pricing.ts).
  ADD COLUMN IF NOT EXISTS cost_usd       NUMERIC(12, 6),
  ADD COLUMN IF NOT EXISTS latency_ms     INTEGER;

-- Consulta típica: "cuánto ha gastado este tenant en IA este mes".
CREATE INDEX IF NOT EXISTS ai_messages_tenant_created_idx
  ON public.ai_messages (tenant_id, created_at DESC);
