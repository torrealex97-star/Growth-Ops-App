import { sql } from '@/lib/vsl/db'

// Sincroniza el % visto (max_position/duration) de una sesión identificada con su contacto,
// para que el cold caller vea en Leads el porcentaje exacto que vio cada lead.
// Guarda siempre el MÁXIMO alcanzado (no baja) y marca vsl_watched_at. Nunca lanza:
// si faltan las columnas vsl_* en algún entorno, se ignora y el tracking sigue.
export async function syncContactWatchPct(
  sess?: { lead_email?: string | null; max_position?: number | string; duration?: number | string }
): Promise<void> {
  if (!sess?.lead_email) return
  const dur = Number(sess.duration) || 0
  const pos = Number(sess.max_position) || 0
  if (dur <= 0 || pos <= 0) return
  const pct = Math.min(100, Math.round((pos / dur) * 100))
  try {
    await sql`
      UPDATE contacts SET
        vsl_watch_pct  = GREATEST(COALESCE(vsl_watch_pct, 0), ${pct}),
        vsl_watched_at = now()
      WHERE lower(email) = ${sess.lead_email}
    `
  } catch {
    // columnas vsl_* pueden no existir en algún entorno -> se ignora
  }
}
