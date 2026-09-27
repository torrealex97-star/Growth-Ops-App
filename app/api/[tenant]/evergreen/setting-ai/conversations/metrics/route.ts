import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { leerSnapshot } from '@/lib/instagram/snapshot'
import { calcularMetricas, type ContactoIg } from '@/lib/instagram/conversation-metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Métricas del panel de Conversaciones: cuántas de las conversaciones de IG generaron agenda/venta
// REALES (cruzando el username del participante con contacts.instagram y sus citas/ventas en BD),
// no una suposición leída del texto. Reutiliza el snapshot que ya guarda /setting-ai/conversations
// (misma fuente que ve el usuario en la lista) para no duplicar llamadas a la Graph API: las
// métricas siempre son coherentes con lo que la pestaña de conversaciones está mostrando.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const platform = req.nextUrl.searchParams.get('platform') || 'instagram'
  if (platform !== 'instagram') {
    return NextResponse.json({ configured: false, platform, motivo: 'Próximamente.' })
  }

  const snap = await leerSnapshot(t.tenantId)
  if (!snap || snap.conversaciones.length === 0) {
    return NextResponse.json({
      configured: false,
      platform,
      motivo: 'Todavía no hay conversaciones descargadas. Abre la pestaña Conversaciones primero.',
    })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: contactosRaw, error: contactosErr } = await sb
    .from('contacts')
    .select('id, instagram')
    .eq('tenant_id', t.tenantId)
    .not('instagram', 'is', null)
  if (contactosErr) {
    return NextResponse.json({ error: `No se pudieron leer los contactos: ${contactosErr.message}` }, { status: 500 })
  }
  const contactos = (contactosRaw || []) as ContactoIg[]
  const contactIds = contactos.map((c) => c.id)

  const [{ data: citas, error: citasErr }, { data: ventas, error: ventasErr }] = await Promise.all([
    contactIds.length
      ? sb.from('appointments').select('contact_id').eq('tenant_id', t.tenantId).in('contact_id', contactIds)
      : Promise.resolve({ data: [] as { contact_id: string }[], error: null }),
    contactIds.length
      ? sb.from('sales').select('contact_id').eq('tenant_id', t.tenantId).in('contact_id', contactIds)
      : Promise.resolve({ data: [] as { contact_id: string }[], error: null }),
  ])
  if (citasErr)
    return NextResponse.json({ error: `No se pudieron leer las citas: ${citasErr.message}` }, { status: 500 })
  if (ventasErr)
    return NextResponse.json({ error: `No se pudieron leer las ventas: ${ventasErr.message}` }, { status: 500 })

  const contactIdsConAgenda = new Set((citas || []).map((c) => c.contact_id))
  const contactIdsConVenta = new Set((ventas || []).map((v) => v.contact_id))

  const { resumen, porConversacion } = calcularMetricas(
    snap.conversaciones,
    contactos,
    contactIdsConAgenda,
    contactIdsConVenta
  )

  return NextResponse.json({
    configured: true,
    platform,
    resumen,
    porConversacion,
    guardado: snap.guardado,
  })
}
