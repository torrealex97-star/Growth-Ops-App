import { NextResponse } from 'next/server'
import { sql } from '@/lib/vsl/db'
import { syncContactWatchPct } from '@/lib/vsl/sync'

export const dynamic = 'force-dynamic'

// Asocia el email (del form de la landing) a la sesión de visionado.
// Así el tracking deja de ser anónimo y se sabe DÓNDE se queda cada lead.
export async function POST(req: Request) {
  try {
    const { sessionId, email, name } = await req.json()
    if (!sessionId) return NextResponse.json({ error: 'sessionId requerido' }, { status: 400 })

    // Descarta merge fields sin resolver (p.ej. GHL manda "{{contact.email}}" literal)
    // y valida que el email tenga pinta de email.
    const isUnresolved = (s: string) => s.includes('{{') || s.includes('}}')
    let cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : null
    if (cleanEmail && (isUnresolved(cleanEmail) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))) {
      cleanEmail = null
    }
    let cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : null
    if (cleanName && isUnresolved(cleanName)) cleanName = null

    if (!cleanEmail && !cleanName) {
      return NextResponse.json({ error: 'email o name inválidos' }, { status: 400 })
    }

    const [sess] = await sql`
      UPDATE vsl_sessions SET
        lead_email = COALESCE(${cleanEmail}, lead_email),
        lead_name  = COALESCE(${cleanName}, lead_name),
        updated_at = now()
      WHERE id = ${sessionId}
      RETURNING lead_email, max_position, duration
    `

    // Al asociar el email, copia de inmediato el % ya visto al contacto (para Leads / cold caller).
    await syncContactWatchPct(sess)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[vsl/identify]', e)
    return NextResponse.json({ error: 'Error al identificar' }, { status: 500 })
  }
}
