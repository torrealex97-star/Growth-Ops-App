import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Detecta conflictos de "ownership" de closer sobre un mismo contacto: si un contacto ya tuvo
// una cita ATENDIDA (show/completed/seguimiento) con un closer, y la agenda más reciente de ese
// mismo contacto tiene un closer distinto (o sin asignar), lo marcamos como conflicto para que
// liderazgo pueda reasignar y no se pierda el ownership real de la relación. Solo lectura/alerta:
// no reasigna nada por sí mismo.
type ApptRow = {
  id: string
  contact_id: string
  closer_id: string | null
  status: string
  appointment_datetime: string
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const contactIdsParam = req.nextUrl.searchParams.get('contactIds') || ''
    const contactIds = contactIdsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (contactIds.length === 0) return NextResponse.json({ conflicts: {} })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    const { data, error } = await sb
      .from('appointments')
      .select('id, contact_id, closer_id, status, appointment_datetime')
      .in('contact_id', contactIds)
      .eq('tenant_id', t.tenantId)
      .order('appointment_datetime', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = (data || []) as ApptRow[]
    const byContact = new Map<string, ApptRow[]>()
    for (const r of rows) {
      if (!r.contact_id) continue
      const arr = byContact.get(r.contact_id)
      if (arr) arr.push(r)
      else byContact.set(r.contact_id, [r])
    }

    const ATTENDED = ['show', 'completed', 'seguimiento']
    const conflicts: Record<string, { owning_closer_id: string; owning_closer_name: string; conflicting_appointment_id: string }> = {}
    const closerIdsNeeded = new Set<string>()

    for (const [contactId, appts] of byContact.entries()) {
      // Ya vienen ordenadas ascendente por fecha (misma query).
      const earliestAttended = appts.find((a) => ATTENDED.includes(a.status) && a.closer_id)
      if (!earliestAttended || !earliestAttended.closer_id) continue

      // Agenda más reciente del contacto (distinta de la que fijó el ownership, si aplica).
      const mostRecent = appts[appts.length - 1]
      if (!mostRecent) continue
      if (mostRecent.id === earliestAttended.id) continue

      if (mostRecent.closer_id !== earliestAttended.closer_id) {
        conflicts[contactId] = {
          owning_closer_id: earliestAttended.closer_id,
          owning_closer_name: '',
          conflicting_appointment_id: mostRecent.id,
        }
        closerIdsNeeded.add(earliestAttended.closer_id)
      }
    }

    if (Object.keys(conflicts).length > 0) {
      const { data: closerUsers } = await sb
        .from('users')
        .select('id, full_name')
        .in('id', Array.from(closerIdsNeeded))
      const nameOf = new Map((closerUsers || []).map((u) => [u.id, u.full_name as string]))
      for (const key of Object.keys(conflicts)) {
        conflicts[key].owning_closer_name = nameOf.get(conflicts[key].owning_closer_id) || 'otro closer'
      }
    }

    return NextResponse.json({ conflicts })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
