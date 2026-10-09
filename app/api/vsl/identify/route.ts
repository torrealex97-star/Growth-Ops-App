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
      RETURNING id, tenant_id, lead_email, max_position, duration
    `

    if (sess && cleanEmail) {
      const [contact] = await sql`
        SELECT id FROM contacts
        WHERE tenant_id = ${sess.tenant_id} AND lower(email) = ${cleanEmail}
        ORDER BY created_at ASC LIMIT 1
      `
      const [playback] = await sql`
        SELECT playback_id, viewer_id FROM vsl_playback_sessions
        WHERE tenant_id = ${sess.tenant_id} AND legacy_session_id = ${sess.id}
        ORDER BY started_at DESC LIMIT 1
      `
      if (contact && playback) {
        await sql`
          INSERT INTO vsl_viewer_identities (tenant_id, viewer_id, contact_id, link_source)
          VALUES (${sess.tenant_id}, ${playback.viewer_id}, ${contact.id}, 'verified_form_email')
          ON CONFLICT (tenant_id, viewer_id, contact_id)
          DO UPDATE SET revoked_at = NULL, linked_at = now(), link_source = EXCLUDED.link_source
        `
        await sql`
          INSERT INTO vsl_tracking_events (
            tenant_id, playback_id, event_id, event_type, occurred_at, visibility_state
          ) VALUES (
            ${sess.tenant_id}, ${playback.playback_id},
            ${`identity:${playback.playback_id}:${contact.id}`}, 'video_viewer_identified', now(), 'visible'
          )
          ON CONFLICT (tenant_id, event_id) DO NOTHING
        `
      }
    }

    // Al asociar el email, copia de inmediato el % ya visto al contacto (para Leads / cold caller).
    await syncContactWatchPct(sess)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[vsl/identify]', e)
    return NextResponse.json({ error: 'Error al identificar' }, { status: 500 })
  }
}
