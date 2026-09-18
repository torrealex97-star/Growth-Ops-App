-- ============================================================================
-- COLABORADORES — identidad estructurada, atribución y scope de datos.
--
-- PRINCIPIO (requisito del brief): "Colaborador = usuario de la app con un scope
-- de datos diferente". NO es un sistema paralelo: reutiliza auth (auth.users +
-- users + tenant_members), roles, permisos por página, RLS, contratos y el LEDGER
-- ÚNICO de comisiones (participant_type nuevo 'collaborator').
--
-- Qué añade esta migración (todo idempotente):
--   1. public.collaborator_profiles — identidad estable del colaborador DENTRO de
--      un tenant: UUID propio (PK), código público inmutable (WDC-0472), estado,
--      contrato, % por defecto. La identidad financiera/atibutiva apunta a este
--      UUID, nunca al código legible ni a texto de un custom field.
--   2. contact_attributions.collaborator_id — la relación canónica
--      contacto↔colaborador, viva en la MISMA fila de atribución que ya conserva
--      first/last touch. NULL = "Directo / Sin colaborador" (estado válido; nunca
--      se inventa un colaborador fake).
--   3. Reglas de comisión y ledger con participant_type='collaborator': el motor
--      existente (cash collected, estados pending/approved/liquidated, espejo
--      negativo de devoluciones, reconcile idempotente, UNIQUE por
--      collection+user+participant que ya da la idempotencia) gobierna sin tocar
--      nada del setter/closer/affiliate.
--   4. Scope de datos en RLS: los colaboradores ven SOLO lo atribuido a su
--      collaborator_profiles.id (contactos, agendas, ventas, cobros,
--      comisiones). La función es_my_collaborator_row() se ENMIENDA a las
--      policies existentes (no las reemplaza): quien ya veía, sigue viendo.
--   5. Aislamiento cross-colaborador: un colaborador NUNCA ve filas atribuidas a
--      otro, ni cuentas globales, aunque manipule URLs/API (RLS, no frontend).
--
-- Estados del colaborador: invited | pending_contract | active | suspended |
-- inactive. Un suspendido pierde el ACCESO (el layout/requireTenant ya exigen
-- membership y esta tabla exige active para el scope), pero sus referrals
-- históricos y sus comisiones sigues existiendo.
--
-- El % de comisión por defecto del programa (affiliate_program_settings) sigue
-- vigente; las reglas finas van por commission_rules con participant_type
-- 'collaborator' (regla por usuario concreto con active_from/active_to, que el
-- motor ya soporta: prioriza la regla scoped al user sobre la genérica).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Perfil del colaborador
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.collaborator_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code             TEXT NOT NULL,
  name             TEXT,
  status           TEXT NOT NULL DEFAULT 'invited'
                   CHECK (status IN ('invited','pending_contract','active','suspended','inactive')),
  contract_id      UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
  contract_version TEXT,
  contract_signed_at TIMESTAMPTZ,
  default_commission_percent NUMERIC(5,2),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un usuario colabora como UNA persona por subcuenta (el mismo humano puede
  -- tener perfiles en tenants distintos; cada uno con su código y su scope).
  CONSTRAINT collaborator_profiles_tenant_user_key UNIQUE (tenant_id, user_id),
  -- El código público es ÚNICO DENTRO de la subcuenta (jamás PK ni FK: es un
  -- identificador de presentación para links ?ref=..., no una identidad).
  CONSTRAINT collaborator_profiles_tenant_code_key UNIQUE (tenant_id, code)
);

CREATE TRIGGER collaborator_profiles_updated_at
  BEFORE UPDATE ON public.collaborator_profiles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Índice para resolver ?ref=CODIGO → id (ruta server-side) y el listado admin.
CREATE INDEX IF NOT EXISTS collaborator_profiles_tenant_idx
  ON public.collaborator_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS collaborator_profiles_code_idx
  ON public.collaborator_profiles (tenant_id, code);
-- FK user_id indexada (estándar del repo: advisor unindexed_foreign_keys a cero;
-- ON DELETE CASCADE desde users escanea este índice, no la tabla).
CREATE INDEX IF NOT EXISTS collaborator_profiles_user_idx
  ON public.collaborator_profiles (user_id);

ALTER TABLE public.collaborator_profiles ENABLE ROW LEVEL SECURITY;

-- Aislamiento RESTRICTIVE por subcuenta (mismo patrón que el resto del pipeline).
DROP POLICY IF EXISTS collaborator_profiles_tenant_isolation ON public.collaborator_profiles;
CREATE POLICY collaborator_profiles_tenant_isolation
  ON public.collaborator_profiles
  AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin());

-- Lectura: el propio colaborador ve SU perfil; el equipo (cualquier miembro con
-- rol) ve los del tenant para las pantallas de gestión.
DROP POLICY IF EXISTS collaborator_profiles_select ON public.collaborator_profiles;
CREATE POLICY collaborator_profiles_select ON public.collaborator_profiles
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.get_my_role() IS NOT NULL
  );

-- Escritura solo de administración (el colaborador no se autoedita: §63).
DROP POLICY IF EXISTS collaborator_profiles_admin_write ON public.collaborator_profiles;
CREATE POLICY collaborator_profiles_admin_write ON public.collaborator_profiles
  FOR ALL USING (public.is_admin_or_director())
  WITH CHECK (public.is_admin_or_director());

-- ----------------------------------------------------------------------------
-- 2) Atribución estructurada del colaborador (columna + índice)
-- ----------------------------------------------------------------------------
-- Vive en contact_attributions (la fila is_primary que ya conserva first/last
-- touch). Es nullable a propósito: NULL = Directo / Sin colaborador.
ALTER TABLE public.contact_attributions
  ADD COLUMN IF NOT EXISTS collaborator_id UUID
  REFERENCES public.collaborator_profiles(id) ON DELETE SET NULL;

-- El contacto que consulta el colaborador, y las aggregates de ranking, filtran
-- por esta columna: el índice es obligatorio para no escanear el tenant entero.
CREATE INDEX IF NOT EXISTS contact_attributions_collaborator_idx
  ON public.contact_attributions (tenant_id, collaborator_id)
  WHERE collaborator_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) participant_type='collaborator' en reglas y ledger
-- ----------------------------------------------------------------------------
ALTER TABLE public.commission_rules
  DROP CONSTRAINT IF EXISTS commission_rules_participant_type_check;
ALTER TABLE public.commission_rules
  ADD CONSTRAINT commission_rules_participant_type_check
  CHECK (participant_type IN ('setter','closer','affiliate','collaborator'));

ALTER TABLE public.commissions
  DROP CONSTRAINT IF EXISTS commissions_participant_type_check;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_participant_type_check
  CHECK (participant_type IN ('setter','closer','affiliate','collaborator'));

-- ----------------------------------------------------------------------------
-- 4) Helpers de RLS (STABLE, invocables por las policies existentes)
-- ----------------------------------------------------------------------------
-- ¿Está esta fila atribuida al colaborador que llama? Resuelve:
--   users.id → collaborator_profiles(tenant, user) → contact_attributions(tenant, contact)
CREATE OR REPLACE FUNCTION public.is_my_collaborator_row(p_contact_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.contact_attributions ca
    JOIN public.collaborator_profiles cp
      ON cp.id = ca.collaborator_id AND cp.tenant_id = ca.tenant_id
    WHERE ca.contact_id = p_contact_id
      AND ca.tenant_id IN (SELECT public.auth_tenant_ids())
      AND cp.user_id = auth.uid()
  );
$$;

-- Hardening estándar del repo (migración 7d0b330): SECURITY DEFINER nunca ejecutable
-- por PUBLIC/anon — solo authenticated, que es quien tiene sesión con auth.uid().
REVOKE ALL ON FUNCTION public.is_my_collaborator_row(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_collaborator_row(UUID) TO authenticated;

-- ¿Fue esta venta/cobro ligado a un contacto atribuido a mí? (para las policies
-- de sales/collections, que no llevan contact_id como columna del mismo sitio).
CREATE OR REPLACE FUNCTION public.is_my_collaborator_sale(p_sale_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.contact_attributions ca
    JOIN public.collaborator_profiles cp
      ON cp.id = ca.collaborator_id AND cp.tenant_id = ca.tenant_id
    JOIN public.sales s ON s.contact_id = ca.contact_id
    WHERE s.id = p_sale_id
      AND ca.tenant_id IN (SELECT public.auth_tenant_ids())
      AND cp.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_my_collaborator_sale(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_collaborator_sale(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5) Scope en RLS: ENMIENDA de las policies existentes (§16).
--    Se añade una rama OR; nadie pierde acceso que ya tuviera.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS contacts_select_scope ON public.contacts;
CREATE POLICY contacts_select_scope ON public.contacts FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR EXISTS (SELECT 1 FROM public.appointments a
             WHERE a.contact_id = contacts.id AND (a.setter_id = auth.uid() OR a.closer_id = auth.uid()))
  OR EXISTS (SELECT 1 FROM public.sales s
             WHERE s.contact_id = contacts.id AND (s.setter_id = auth.uid() OR s.closer_id = auth.uid()))
  OR public.is_my_collaborator_row(contacts.id)
);

DROP POLICY IF EXISTS contact_attributions_select_scope ON public.contact_attributions;
CREATE POLICY contact_attributions_select_scope ON public.contact_attributions FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR EXISTS (SELECT 1 FROM public.appointments a
             WHERE a.contact_id = contact_attributions.contact_id AND (a.setter_id = auth.uid() OR a.closer_id = auth.uid()))
  OR EXISTS (SELECT 1 FROM public.sales s
             WHERE s.contact_id = contact_attributions.contact_id AND (s.setter_id = auth.uid() OR s.closer_id = auth.uid()))
  OR public.is_my_collaborator_row(contact_attributions.contact_id)
);

DROP POLICY IF EXISTS sales_select_scope ON public.sales;
CREATE POLICY sales_select_scope ON public.sales FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR setter_id = auth.uid()
  OR closer_id = auth.uid()
  OR public.is_my_collaborator_sale(sales.id)
);

DROP POLICY IF EXISTS appointments_select_scope ON public.appointments;
CREATE POLICY appointments_select_scope ON public.appointments FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR setter_id = auth.uid()
  OR closer_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.contact_attributions ca
             WHERE ca.contact_id = appointments.contact_id
               AND public.is_my_collaborator_row(ca.contact_id))
);

DROP POLICY IF EXISTS collections_select_scope ON public.collections;
CREATE POLICY collections_select_scope ON public.collections FOR SELECT USING (
  is_admin_or_director()
  OR my_data_scope() = 'team'
  OR EXISTS (SELECT 1 FROM public.sales s
             WHERE s.id = collections.sale_id AND (s.setter_id = auth.uid() OR s.closer_id = auth.uid()))
  OR public.is_my_collaborator_sale(collections.sale_id)
);

-- COMISIONES: el colaborador solo ve SU ledger (las policies previas ya dejaban
-- user_id = auth.uid() leer sus propias comisiones; no necesitan enmienda).
-- COMMISSION_RULES: solo configuración de admin (ya cubierto).
-- CONTACT_NOTES / ACTIVITIES: SIN enmienda → un colaborador NO ve notas internas
-- ni interacciones del equipo (§21: privacidad por defecto).
-- PAYMENT_FOLLOW_UPS: idem, sin enmienda.

-- ----------------------------------------------------------------------------
-- 6) Índices para las queries del dashboard del colaborador (§65)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS sales_contact_id_status_idx
  ON public.sales (contact_id, status);
CREATE INDEX IF NOT EXISTS appointments_contact_id_status_idx
  ON public.appointments (contact_id, status);

-- ----------------------------------------------------------------------------
-- 7) Backfill determinista de perfiles desde el modelo vigente.
--    Cada users con affiliate_code y membership activa en un tenant pasa a tener
--    su collaborator_profile: code = affiliate_code (mismo valor que ya llevan
--    los enlaces utm_content), % por defecto preservado, estado active si su
--    usuario está activo. Nada de emails: no se adivina ni se crea nada ambiguo.
-- ----------------------------------------------------------------------------
INSERT INTO public.collaborator_profiles
      (tenant_id, user_id, code, name, status, default_commission_percent)
SELECT tm.tenant_id,
       u.id,
       u.affiliate_code,
       u.full_name,
       CASE WHEN COALESCE(u.is_active, false) THEN 'active' ELSE 'inactive' END,
       u.default_affiliate_commission_percent
FROM public.users u
JOIN public.tenant_members tm ON tm.user_id = u.id
WHERE u.affiliate_code IS NOT NULL
  AND u.affiliate_code <> ''
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- ============================================================================
-- NOTAS DE APLICACIÓN (igual que la migración de hardening: se aplica en
-- producción vía SQL Editor / pooler; el fichero vive en supabase/migrations).
-- APLICADA en producción 2026-09-18 vía pooler transaccional
-- (postgres-js, prepare:false) tras el bloqueo DNS del host directo IPv6.
-- Verificación estructural post-aplicación: tabla, columna, CHECK, 3 policies,
-- 2 funciones de scope, índices y backfill (0 filas: no había usuarios con
-- affiliate_code — nada que migrar). Tipos regenerados con `npm run tipos:bd`
-- (95 relaciones) y commiteados (el test de invariante exige frescura).
-- ============================================================================
