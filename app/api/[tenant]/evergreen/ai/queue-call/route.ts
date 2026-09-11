import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Encola una grabación de Drive para transcripción en segundo plano (worker de Railway).
// Guarda el enlace y pone transcript_status='pendiente'. El worker la procesa (cualquier duración).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, driveUrl } = await req.json()
    if (!appointmentId || !driveUrl) return NextResponse.json({ error: 'Falta appointmentId o driveUrl' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { error } = await sb.from('appointments')
      .update({ transcript_drive_url: driveUrl, transcript_status: 'pendiente' })
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, queued: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
