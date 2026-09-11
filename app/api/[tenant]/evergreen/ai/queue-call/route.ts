import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Encola una grabación de Drive para transcripción en segundo plano (worker de Railway).
// Guarda el enlace y pone transcript_status='pendiente'. El worker la procesa (cualquier duración).
export async function POST(req: NextRequest) {
  try {
    const { appointmentId, driveUrl } = await req.json()
    if (!appointmentId || !driveUrl) return NextResponse.json({ error: 'Falta appointmentId o driveUrl' }, { status: 400 })

    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { error } = await sb.from('appointments')
      .update({ transcript_drive_url: driveUrl, transcript_status: 'pendiente' })
      .eq('id', appointmentId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, queued: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
