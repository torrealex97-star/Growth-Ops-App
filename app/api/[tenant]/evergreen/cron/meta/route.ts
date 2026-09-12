import { NextRequest, NextResponse } from 'next/server'
import { ensureConfig } from '@/lib/config'
import { createClient } from '@supabase/supabase-js'
import { runMetaSync } from '@/lib/meta/sync'

export const runtime = 'nodejs'
export const maxDuration = 60

// Cron de Vercel (cada 30 min) → sincroniza Meta hacia `campaigns` y actualiza
// el gasto del mes en Finanzas/P&L. Vercel Cron inyecta Authorization: Bearer CRON_SECRET.
//
// BUGFIX (regresión de la migración multi-tenant, no hardening rutinario): runMetaSync ahora
// exige tenantId — filtra integration_settings/contact_attributions/appointments/sales/campaigns
// por tenant y estampa tenant_id en cada fila nueva. Vercel Cron pega a una única URL estática,
// así que este handler recorre TODAS las subcuentas activas y corre la sync una vez por cada una.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) throw new Error(tenantsErr.message)

    const perTenant: Record<string, unknown> = {}
    for (const tn of tenants || []) {
      await ensureConfig(tn.id)
      perTenant[tn.slug] = await runMetaSync(sb, tn.id)
    }
    return NextResponse.json({ ok: true, tenants: perTenant })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error al sincronizar con Meta'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
