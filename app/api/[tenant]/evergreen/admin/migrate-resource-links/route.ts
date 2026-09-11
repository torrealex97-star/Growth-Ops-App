import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 60

// Crea la tabla RESOURCE_LINKS (enlaces varios por tipología, sin UTM). Idempotente.
// Se ejecuta en runtime de Vercel (donde POSTGRES_URL sí está poblado; en local está vacío).
// Acceso: sesión admin/director de esta subcuenta (o super_admin)  O  Authorization: Bearer <CRON_SECRET>.
// Es DDL global (crea tablas si no existen), no hay datos tenant-scoped que filtrar aquí.
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
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
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

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS public.resource_link_divisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS public.resource_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        category TEXT NOT NULL DEFAULT 'General',
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        applies_to TEXT[] NOT NULL DEFAULT '{}',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INT NOT NULL DEFAULT 0,
        created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE public.resource_links
        ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES public.resource_link_divisions(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS resource_links_category_idx ON public.resource_links(category);
      CREATE INDEX IF NOT EXISTS resource_links_division_idx ON public.resource_links(division_id);
    `)

    try {
      await sql.unsafe(`
        DROP TRIGGER IF EXISTS resource_links_updated_at ON public.resource_links;
        CREATE TRIGGER resource_links_updated_at BEFORE UPDATE ON public.resource_links FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
        DROP TRIGGER IF EXISTS resource_link_divisions_updated_at ON public.resource_link_divisions;
        CREATE TRIGGER resource_link_divisions_updated_at BEFORE UPDATE ON public.resource_link_divisions FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
      `)
      report.triggers = 'ok'
    } catch (e) {
      report.triggers = `skip: ${e instanceof Error ? e.message : String(e)}`
    }

    try {
      await sql.unsafe(`
        ALTER TABLE public.resource_links ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS rl_select ON public.resource_links;
        CREATE POLICY rl_select ON public.resource_links FOR SELECT
          USING (is_admin_or_director() OR cardinality(applies_to) = 0 OR get_my_role() = ANY(applies_to));
        DROP POLICY IF EXISTS rl_modify ON public.resource_links;
        CREATE POLICY rl_modify ON public.resource_links FOR ALL
          USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());

        ALTER TABLE public.resource_link_divisions ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS rld_select ON public.resource_link_divisions;
        CREATE POLICY rld_select ON public.resource_link_divisions FOR SELECT USING (get_my_role() IS NOT NULL);
        DROP POLICY IF EXISTS rld_modify ON public.resource_link_divisions;
        CREATE POLICY rld_modify ON public.resource_link_divisions FOR ALL
          USING (is_admin_or_director()) WITH CHECK (is_admin_or_director());
      `)
      report.rls = 'ok'
    } catch (e) {
      report.rls = `skip: ${e instanceof Error ? e.message : String(e)}`
    }

    await sql.end()
    report.ddl = 'ok'
    return NextResponse.json({ ok: true, report })
  } catch (e) {
    report.ddl = `error: ${e instanceof Error ? e.message : String(e)}`
    return NextResponse.json({ ok: false, report }, { status: 500 })
  }
}
