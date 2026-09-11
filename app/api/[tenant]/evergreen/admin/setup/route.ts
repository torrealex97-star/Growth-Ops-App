import { NextRequest, NextResponse } from 'next/server'
import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const maxDuration = 60

// Endpoint de mantenimiento idempotente. Autenticado con CRON_SECRET.
//  · aplica el DDL pendiente (v16/v17) por si no se pudo correr por CLI.
//  · asegura que los buckets de Storage 'contratos' y 'facturas' son PÚBLICOS
//    (arregla las descargas de facturas que devolvían 403 por bucket privado).
// Uso: POST /api/${tenant}/evergreen/admin/setup  con cabecera  x-cron-secret: <CRON_SECRET>
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  // Este endpoint es de mantenimiento global (autenticado por secreto, no por sesión de usuario),
  // pero algunas de las tablas que toca (contract_templates, company_profile) ganaron una columna
  // tenant_id NOT NULL en la migración multi-tenant — sin resolverla aquí los INSERT fallarían.
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  const accepted = [process.env.CRON_SECRET, process.env.SETUP_SECRET].filter(Boolean)
  if (!accepted.length || !accepted.includes(secret || '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { tenant } = await params
  const report: Record<string, unknown> = {}

  // ---- 1) DDL idempotente ----
  try {
    const sql = postgres(process.env.POSTGRES_URL!, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20 })
    const [tenantRow] = await sql`SELECT id FROM public.tenants WHERE slug = ${tenant}`
    if (!tenantRow) {
      await sql.end()
      return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })
    }
    const tenantId = tenantRow.id as string
    await sql.unsafe(`
      -- v16
      CREATE TABLE IF NOT EXISTS public.contract_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL, role_key TEXT, body TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE, created_by UUID REFERENCES public.users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id);
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.contract_templates(id);
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'venta';
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signing_token TEXT;
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS terms JSONB;
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS body_snapshot TEXT;
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signer_name TEXT;
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signer_ip TEXT;
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signer_user_agent TEXT;
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signed_hash TEXT;
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signed_pdf_url TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS contracts_signing_token_idx ON public.contracts(signing_token) WHERE signing_token IS NOT NULL;
      -- v17
      CREATE TABLE IF NOT EXISTS public.company_profile (
        id INT PRIMARY KEY DEFAULT 1, name TEXT NOT NULL DEFAULT 'Tu Empresa', legal_name TEXT, cif TEXT,
        address TEXT, postal_code TEXT, city TEXT, country TEXT DEFAULT 'España', representative TEXT,
        email TEXT, phone TEXT, logo_url TEXT, email_signature TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS signer_data JSONB;
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS contract_role TEXT;
      ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ;
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS dni TEXT;
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address TEXT;
    `)
    // company_profile.tenant_id es NOT NULL (migración multi-tenant) — el INSERT vive fuera del
    // bloque .unsafe() de arriba para poder parametrizar tenantId de forma segura. company_profile
    // sigue siendo un singleton por PK (id=1): si ya existe una fila (de otra subcuenta), este
    // ON CONFLICT no la duplica ni la reasigna — limitación de diseño de esta tabla, no de esta ruta.
    try {
      await sql`
        INSERT INTO public.company_profile (id, tenant_id, name)
        VALUES (1, ${tenantId}, 'Tu Empresa')
        ON CONFLICT (id) DO NOTHING
      `
      report.company_profile = 'ok'
    } catch (e) {
      report.company_profile = `error: ${e instanceof Error ? e.message : String(e)}`
    }
    // v18 — Atribución automática de ventas desde la agenda (red de seguridad server-side).
    // En cualquier INSERT de venta con agenda, rellena setter/closer/afiliado si vienen vacíos.
    // El setter toma cold_caller si no hay setter (ambos cobran como setter).
    try {
      await sql.unsafe(`
        CREATE OR REPLACE FUNCTION public.attribute_sale_from_appointment() RETURNS trigger AS $func$
        DECLARE apt RECORD;
        BEGIN
          IF NEW.appointment_id IS NOT NULL THEN
            SELECT setter_id, closer_id, cold_caller_id, affiliate_id INTO apt FROM public.appointments WHERE id = NEW.appointment_id;
            IF NEW.setter_id IS NULL THEN NEW.setter_id := COALESCE(apt.setter_id, apt.cold_caller_id); END IF;
            IF NEW.closer_id IS NULL THEN NEW.closer_id := apt.closer_id; END IF;
            IF NEW.affiliate_id IS NULL THEN NEW.affiliate_id := apt.affiliate_id; END IF;
          END IF;
          RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;
        DROP TRIGGER IF EXISTS sales_attribute_from_appointment ON public.sales;
        CREATE TRIGGER sales_attribute_from_appointment BEFORE INSERT ON public.sales
          FOR EACH ROW EXECUTE FUNCTION public.attribute_sale_from_appointment();
      `)
      report.sales_trigger = 'ok'
    } catch (e) {
      report.sales_trigger = `error: ${e instanceof Error ? e.message : String(e)}`
    }
    // v18b — conflicto de atribución (first vs last touch) para revisión del admin.
    try {
      await sql.unsafe(`
        ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS attribution_conflict BOOLEAN NOT NULL DEFAULT false;
        ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS attribution_meta JSONB;
        CREATE INDEX IF NOT EXISTS sales_attribution_conflict_idx ON public.sales(attribution_conflict) WHERE attribution_conflict = true;
      `)
      report.sales_attribution_cols = 'ok'
    } catch (e) {
      report.sales_attribution_cols = `error: ${e instanceof Error ? e.message : String(e)}`
    }
    // Políticas RLS (ejecutadas por separado por si get_my_role falta)
    try {
      await sql.unsafe(`
        ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS contract_templates_select ON public.contract_templates;
        CREATE POLICY contract_templates_select ON public.contract_templates FOR SELECT USING (get_my_role() IN ('admin','director','manager','gestoria','csm'));
        DROP POLICY IF EXISTS contract_templates_modify ON public.contract_templates;
        CREATE POLICY contract_templates_modify ON public.contract_templates FOR ALL USING (get_my_role() IN ('admin','director')) WITH CHECK (get_my_role() IN ('admin','director'));
        ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS company_profile_select ON public.company_profile;
        CREATE POLICY company_profile_select ON public.company_profile FOR SELECT USING (get_my_role() IN ('admin','director','manager','gestoria','csm'));
        DROP POLICY IF EXISTS company_profile_modify ON public.company_profile;
        CREATE POLICY company_profile_modify ON public.company_profile FOR ALL USING (get_my_role() IN ('admin','director')) WITH CHECK (get_my_role() IN ('admin','director'));
      `)
      report.rls = 'ok'
    } catch (e) {
      report.rls = `skip: ${e instanceof Error ? e.message : String(e)}`
    }
    // v21 — Sugerencias y mejoras de la plataforma (enviadas por el equipo).
    try {
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS public.suggestions (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
          type        TEXT NOT NULL DEFAULT 'mejora' CHECK (type IN ('mejora','error','comentario')),
          title       TEXT NOT NULL,
          message     TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'nueva' CHECK (status IN ('nueva','en_revision','planificada','en_progreso','resuelta','descartada')),
          admin_notes TEXT,
          page_url    TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS suggestions_status_idx  ON public.suggestions(status);
        CREATE INDEX IF NOT EXISTS suggestions_user_idx    ON public.suggestions(user_id);
        CREATE INDEX IF NOT EXISTS suggestions_created_idx ON public.suggestions(created_at DESC);
        DROP TRIGGER IF EXISTS suggestions_updated_at ON public.suggestions;
        CREATE TRIGGER suggestions_updated_at BEFORE UPDATE ON public.suggestions
          FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
        ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS suggestions_insert_self ON public.suggestions;
        CREATE POLICY suggestions_insert_self ON public.suggestions FOR INSERT WITH CHECK (user_id = auth.uid());
        DROP POLICY IF EXISTS suggestions_select ON public.suggestions;
        CREATE POLICY suggestions_select ON public.suggestions FOR SELECT USING (user_id = auth.uid() OR is_admin_or_director());
        DROP POLICY IF EXISTS suggestions_update_admin ON public.suggestions;
        CREATE POLICY suggestions_update_admin ON public.suggestions FOR UPDATE USING (is_admin_or_director());
        DROP POLICY IF EXISTS suggestions_delete_admin ON public.suggestions;
        CREATE POLICY suggestions_delete_admin ON public.suggestions FOR DELETE USING (is_admin_or_director());
      `)
      report.suggestions = 'ok'
    } catch (e) {
      report.suggestions = `error: ${e instanceof Error ? e.message : String(e)}`
    }
    // Plantilla por defecto si esta subcuenta no tiene ninguna (contract_templates.tenant_id es
    // NOT NULL desde la migración multi-tenant — contamos/insertamos scoped a este tenantId para
    // que cada subcuenta reciba su propia plantilla por defecto, no solo la primera que llame a /setup).
    const [{ count }] =
      await sql`SELECT count(*)::int AS count FROM public.contract_templates WHERE tenant_id = ${tenantId}`
    if (count === 0) {
      await sql`INSERT INTO public.contract_templates (tenant_id, name, role_key, body) VALUES (
        ${tenantId}, 'Contrato colaborador comercial (setter/closer)', 'closer',
        ${'CONTRATO DE PRESTACIÓN DE SERVICIOS COMERCIALES\n\nDe una parte, {{empresa}}, con CIF {{cif}}, en adelante "LA EMPRESA".\nDe otra parte, {{nombre}}, con DNI {{dni}}, email {{email}} y domicilio en {{direccion}}, en adelante "EL COLABORADOR".\n\nPRIMERA — OBJETO\nEl Colaborador prestará servicios comerciales en el rol de {{rol}}, con fecha de alta {{fecha}}.\n\nSEGUNDA — CONDICIONES ECONÓMICAS\nSegún el apartado "CONDICIONES ECONÓMICAS ACORDADAS" de este documento.\n\nTERCERA — CONFIDENCIALIDAD\nEl Colaborador mantendrá la confidencialidad de la información a la que acceda.\n\nY en prueba de conformidad, firma electrónicamente el presente contrato.'}
      )`
      report.seed_template = 'inserted'
    } else report.seed_template = `exists (${count})`
    await sql.end()
    report.ddl = 'ok'
  } catch (e) {
    report.ddl = `error: ${e instanceof Error ? e.message : String(e)}`
  }

  // ---- 2) Buckets públicos ----
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    })
    const buckets = ['contratos', 'facturas']
    const bucketReport: Record<string, string> = {}
    for (const b of buckets) {
      const { data: existing } = await sb.storage.getBucket(b)
      if (!existing) {
        const { error } = await sb.storage.createBucket(b, { public: true })
        bucketReport[b] = error ? `create error: ${error.message}` : 'created public'
      } else if (!existing.public) {
        const { error } = await sb.storage.updateBucket(b, { public: true })
        bucketReport[b] = error ? `update error: ${error.message}` : 'made public'
      } else {
        bucketReport[b] = 'already public'
      }
    }
    report.buckets = bucketReport
  } catch (e) {
    report.buckets = `error: ${e instanceof Error ? e.message : String(e)}`
  }

  return NextResponse.json({ ok: true, report })
}
