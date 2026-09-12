import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 60

// Aplica el DDL del PROGRAMA DE AFILIADOS (migración v18). Idempotente.
// Se ejecuta en runtime de Vercel (donde POSTGRES_URL sí está poblado; en local está vacío).
// Acceso: sesión admin/director de esta subcuenta (o super_admin)  O  Authorization: Bearer <CRON_SECRET>.
// Es DDL global (crea tablas si no existen) + una fila singleton de configuración por defecto,
// no hay datos propiamente tenant-scoped que filtrar aquí.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = req.headers.get('authorization')
  const viaCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`

  if (!viaCron) {
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll() {},
        },
      }
    )
    const {
      data: { user },
    } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key
    if (!t.isSuperAdmin && !['admin', 'director'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
  }

  const report: Record<string, unknown> = {}
  try {
    const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20 })

    // --- Tablas ---
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS public.affiliate_campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'otro',
        base_url TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS public.affiliate_campaign_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id UUID NOT NULL REFERENCES public.affiliate_campaigns(id) ON DELETE CASCADE,
        affiliate_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (campaign_id, affiliate_id)
      );
      CREATE INDEX IF NOT EXISTS acm_campaign_idx ON public.affiliate_campaign_members(campaign_id);
      CREATE INDEX IF NOT EXISTS acm_affiliate_idx ON public.affiliate_campaign_members(affiliate_id);
      CREATE TABLE IF NOT EXISTS public.affiliate_profiles (
        user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
        instagram TEXT, audience_size TEXT, niche TEXT, source TEXT, motivation TEXT, extra JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS public.affiliate_program_settings (
        id INT PRIMARY KEY DEFAULT 1,
        default_commission_percent NUMERIC(5,2) NOT NULL DEFAULT 20,
        program_name TEXT NOT NULL DEFAULT 'Programa de Afiliados',
        intro TEXT NOT NULL DEFAULT 'Únete a nuestro programa de afiliados. Rellena tus datos y te damos de alta al instante.',
        success_message TEXT NOT NULL DEFAULT '¡Listo! Te hemos enviado un email para crear tu contraseña y acceder a tu panel.',
        form_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT affiliate_program_settings_singleton CHECK (id = 1)
      );
    `)

    // --- Triggers updated_at ---
    try {
      await sql.unsafe(`
        DROP TRIGGER IF EXISTS affiliate_campaigns_updated_at ON public.affiliate_campaigns;
        CREATE TRIGGER affiliate_campaigns_updated_at BEFORE UPDATE ON public.affiliate_campaigns FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
        DROP TRIGGER IF EXISTS affiliate_profiles_updated_at ON public.affiliate_profiles;
        CREATE TRIGGER affiliate_profiles_updated_at BEFORE UPDATE ON public.affiliate_profiles FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
        DROP TRIGGER IF EXISTS affiliate_program_settings_updated_at ON public.affiliate_program_settings;
        CREATE TRIGGER affiliate_program_settings_updated_at BEFORE UPDATE ON public.affiliate_program_settings FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
      `)
      report.triggers = 'ok'
    } catch (e) {
      report.triggers = `skip: ${e instanceof Error ? e.message : String(e)}`
    }

    // --- RLS ---
    try {
      await sql.unsafe(`
        ALTER TABLE public.affiliate_campaigns ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS ac_select ON public.affiliate_campaigns;
        CREATE POLICY ac_select ON public.affiliate_campaigns FOR SELECT USING (get_my_role() IS NOT NULL);
        DROP POLICY IF EXISTS ac_modify ON public.affiliate_campaigns;
        CREATE POLICY ac_modify ON public.affiliate_campaigns FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

        ALTER TABLE public.affiliate_campaign_members ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS acm_select ON public.affiliate_campaign_members;
        CREATE POLICY acm_select ON public.affiliate_campaign_members FOR SELECT USING (is_admin_or_director() OR affiliate_id = auth.uid());
        DROP POLICY IF EXISTS acm_modify ON public.affiliate_campaign_members;
        CREATE POLICY acm_modify ON public.affiliate_campaign_members FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

        ALTER TABLE public.affiliate_profiles ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS ap_select ON public.affiliate_profiles;
        CREATE POLICY ap_select ON public.affiliate_profiles FOR SELECT USING (is_admin_or_director() OR user_id = auth.uid());
        DROP POLICY IF EXISTS ap_modify ON public.affiliate_profiles;
        CREATE POLICY ap_modify ON public.affiliate_profiles FOR ALL USING (is_admin_or_director() OR user_id = auth.uid()) WITH CHECK (is_admin_or_director() OR user_id = auth.uid());

        ALTER TABLE public.affiliate_program_settings ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS aps_select ON public.affiliate_program_settings;
        CREATE POLICY aps_select ON public.affiliate_program_settings FOR SELECT USING (get_my_role() IS NOT NULL);
        DROP POLICY IF EXISTS aps_modify ON public.affiliate_program_settings;
        CREATE POLICY aps_modify ON public.affiliate_program_settings FOR ALL USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());
      `)
      report.rls = 'ok'
    } catch (e) {
      report.rls = `skip: ${e instanceof Error ? e.message : String(e)}`
    }

    // --- Fila de settings por defecto con el set de campos inicial ---
    await sql.unsafe(`
      INSERT INTO public.affiliate_program_settings (id, form_fields)
      VALUES (1, '[
        {"key":"full_name","label":"Nombre completo","enabled":true,"required":true,"fixed":true},
        {"key":"email","label":"Email","enabled":true,"required":true,"fixed":true},
        {"key":"phone","label":"Teléfono (WhatsApp)","enabled":true,"required":true},
        {"key":"instagram","label":"Instagram / red principal","enabled":true,"required":true},
        {"key":"audience_size","label":"Tamaño de tu audiencia","enabled":true,"required":false},
        {"key":"niche","label":"Nicho / a qué te dedicas","enabled":true,"required":false},
        {"key":"source","label":"¿Cómo nos conociste?","enabled":true,"required":false}
      ]'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    `)

    await sql.end()
    report.ddl = 'ok'
    return NextResponse.json({ ok: true, report })
  } catch (e) {
    report.ddl = `error: ${e instanceof Error ? e.message : String(e)}`
    return NextResponse.json({ ok: false, report }, { status: 500 })
  }
}
