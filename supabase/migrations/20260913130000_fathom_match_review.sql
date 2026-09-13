-- Cola de revisión para reuniones de Fathom que no se pueden emparejar sin adivinar.
--
-- POR QUÉ EXISTE. El sync anterior, cuando encontraba varias citas candidatas en una ventana de
-- ±12 h, escribía la transcripción en TODAS, con un comentario que lo presentaba como lo prudente
-- ("mejor que arriesgar una asociación incorrecta"). En realidad:
--   - Duplicaba la misma llamada en N citas, así que el análisis de IA y las herramientas de Voice
--     of Customer la contaban N veces.
--   - Estampaba el mismo fathom_meeting_id en N filas.
--   - En el re-sync siguiente, la comprobación de "ya importada" encontraba una y saltaba: parecía
--     idempotente habiendo dejado N-1 filas con una llamada que no ocurrió ahí.
-- Atribuir una llamada a una cita donde no pasó no es más prudente que no atribuirla. Ahora los
-- casos dudosos aterrizan aquí y los resuelve una persona.

CREATE TABLE public.fathom_match_review (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES public.tenants(id),
  -- Identificador estable de la reunión en Fathom (share_url/url).
  fathom_meeting_id  TEXT NOT NULL,
  -- Datos mínimos para que una persona decida sin salir de la pantalla. NO se guarda la
  -- transcripción: es el cuerpo grande y ya se importará al resolver, cuando se sepa el destino.
  meeting_started_at TIMESTAMPTZ,
  invitee_email      TEXT,
  recording_url      TEXT,
  -- Citas entre las que hay que elegir. Vacío = no había ninguna candidata.
  candidate_appointment_ids UUID[] NOT NULL DEFAULT '{}',
  -- 'ambigua' = varias candidatas plausibles; 'sin_candidatos' = no hay a qué vincularla.
  reason_kind        TEXT NOT NULL CHECK (reason_kind IN ('ambigua', 'sin_candidatos')),
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pendiente'
                       CHECK (status IN ('pendiente', 'resuelta', 'descartada')),
  -- Cita elegida al resolver. Obligatoria si se resolvió, prohibida si no: así no queda una fila
  -- "resuelta" sin decir a qué, ni una pendiente con un destino a medias.
  resolved_appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  resolved_by        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fathom_review_resolution_coherent CHECK (
    (status = 'resuelta' AND resolved_appointment_id IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status <> 'resuelta' AND resolved_appointment_id IS NULL)
  )
);

-- Idempotencia del sync: una reunión de Fathom no puede generar dos entradas en la cola de la misma
-- subcuenta. Sin esto, cada re-sync añadiría un duplicado de cada caso dudoso.
CREATE UNIQUE INDEX fathom_match_review_tenant_meeting_key
  ON public.fathom_match_review(tenant_id, fathom_meeting_id);

-- Lo que se consulta siempre es "qué queda pendiente en esta subcuenta".
CREATE INDEX fathom_match_review_pendientes_idx
  ON public.fathom_match_review(tenant_id, created_at DESC)
  WHERE status = 'pendiente';

CREATE TRIGGER fathom_match_review_updated_at
  BEFORE UPDATE ON public.fathom_match_review
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public.fathom_match_review ENABLE ROW LEVEL SECURITY;

-- Resolver una entrada escribe la transcripción en una cita, así que es una decisión de datos:
-- solo admin/director. El resto del equipo con sesión puede verla (mismo patrón que partners).
CREATE POLICY "fathom_review_admin_write" ON public.fathom_match_review FOR ALL
  USING (is_admin_or_director())
  WITH CHECK (is_admin_or_director());
CREATE POLICY "fathom_review_select_team" ON public.fathom_match_review FOR SELECT
  USING (get_my_role() IS NOT NULL);

CREATE POLICY "fathom_review_tenant_isolation" ON public.fathom_match_review AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());
