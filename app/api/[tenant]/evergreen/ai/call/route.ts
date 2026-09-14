import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { analyzeCall } from '@/lib/ai/claude'
import { requireTenant } from '@/lib/auth/requireTenant'
import { tenantAiEnv } from '@/lib/ai/provider'
import { GROQ_LIMIT_BYTES, transcribeAudio } from '@/lib/ai/groq'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 300

function driveFileId(url: string): string | null {
  const m = url.match(/\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/)
  return m ? m[1] : null
}

const NOT_PUBLIC =
  "El archivo de Drive no es público. En Drive: botón 'Compartir' → 'Cualquiera con el enlace' → 'Lector', y reintenta."

async function downloadFromDrive(fileId: string): Promise<{ buf: Buffer; type: string }> {
  const isBinary = (ct: string) => ct && !ct.includes('text/html') && !ct.includes('application/json')

  // 1) Google Drive API con API key (si está configurada) — lo más fiable para archivos públicos
  if (process.env.GOOGLE_API_KEY) {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${process.env.GOOGLE_API_KEY}`
    )
    const ct = r.headers.get('content-type') || ''
    if (r.ok && isBinary(ct)) return { buf: Buffer.from(await r.arrayBuffer()), type: ct }
  }

  // 2) Descarga directa; si Google devuelve HTML es página de confirmación o de error
  const first = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, { redirect: 'follow' })
  const ct1 = first.headers.get('content-type') || ''
  if (first.ok && isBinary(ct1)) return { buf: Buffer.from(await first.arrayBuffer()), type: ct1 }

  const html = await first.text()
  if (/can't download|no se puede|sign in|request access|acceso|denied|need access/i.test(html)) {
    throw new Error(NOT_PUBLIC)
  }
  // Página de confirmación de archivo grande: extraer form action + inputs y seguirlo
  const action = html.match(/action="([^"]+download[^"]*)"/)?.[1]?.replace(/&amp;/g, '&')
  if (action) {
    const params = new URLSearchParams()
    for (const m of Array.from(html.matchAll(/name="([^"]+)"\s+value="([^"]*)"/g))) params.set(m[1], m[2])
    const r2 = await fetch(`${action}?${params.toString()}`)
    const ct2 = r2.headers.get('content-type') || ''
    if (r2.ok && isBinary(ct2)) return { buf: Buffer.from(await r2.arrayBuffer()), type: ct2 }
  }
  // Último intento: endpoint usercontent con confirm
  const r3 = await fetch(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`)
  const ct3 = r3.headers.get('content-type') || ''
  if (r3.ok && isBinary(ct3)) return { buf: Buffer.from(await r3.arrayBuffer()), type: ct3 }

  throw new Error(NOT_PUBLIC)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { appointmentId, driveUrl, transcript: providedTranscript } = await req.json()
    if (!appointmentId) return NextResponse.json({ error: 'Falta appointmentId' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // Cargar agenda + contacto + producto + comercial
    const { data: appt, error: apptErr } = await sb
      .from('appointments')
      .select('id, closer_id, setter_id, transcript, contacts(id, full_name, lead_status)')
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (apptErr || !appt) return NextResponse.json({ error: 'Agenda no encontrada' }, { status: 404 })

    // 1) Transcripción
    let transcript: string = providedTranscript || appt.transcript || ''
    if (!transcript && driveUrl) {
      const fileId = driveFileId(driveUrl)
      if (!fileId) return NextResponse.json({ error: 'Enlace de Drive no válido' }, { status: 400 })
      await sb
        .from('appointments')
        .update({ transcript_status: 'procesando', transcript_drive_url: driveUrl })
        .eq('id', appointmentId)
        .eq('tenant_id', t.tenantId)
      const { buf, type } = await downloadFromDrive(fileId)
      if (buf.byteLength > GROQ_LIMIT_BYTES) {
        await sb
          .from('appointments')
          .update({ transcript_status: 'error' })
          .eq('id', appointmentId)
          .eq('tenant_id', t.tenantId)
        return NextResponse.json(
          {
            error: `El archivo pesa ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB y supera el límite de 25MB de la transcripción gratuita. Sube solo el audio (mp3) o activa la transcripción de Meet y pega el texto.`,
          },
          { status: 413 }
        )
      }
      // Clave de Groq de ESTA subcuenta (antes: process.env, así que la del panel no se usaba).
      const groqKey = (await getTenantConfigWithFallback(t.tenantId)).GROQ_API_KEY
      transcript = await transcribeAudio(buf, type, groqKey, { filename: 'call' })
      await sb
        .from('appointments')
        .update({ transcript, transcript_status: 'listo' })
        .eq('id', appointmentId)
        .eq('tenant_id', t.tenantId)
    }
    if (!transcript || transcript.trim().length < 20) {
      return NextResponse.json(
        { error: 'No hay transcripción (pega el texto o un enlace de Drive válido)' },
        { status: 400 }
      )
    }

    // 2) Análisis IA
    const contact = appt.contacts as { id?: string; full_name?: string } | null
    const analysis = await analyzeCall(transcript, { leadName: contact?.full_name }, await tenantAiEnv(t.tenantId))

    await sb
      .from('appointments')
      .update({
        transcript,
        transcript_status: 'listo',
        ai_call_score: analysis.call_score,
        ai_lead_score: analysis.lead_score,
        ai_suggested_stage: analysis.suggested_stage,
        ai_summary: analysis.summary,
        ai_analysis: { objections: analysis.objections, next_steps: analysis.next_steps },
        ai_analyzed_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .eq('tenant_id', t.tenantId)

    // 3) Generación automática de tareas: DESACTIVADA temporalmente.
    // (Pendiente de entrenar qué tareas deben salir tras una venta/llamada.)
    // La IA sigue proponiendo tareas en analysis.tasks, pero NO se insertan.

    return NextResponse.json({ ok: true, transcript, analysis, tasksCreated: 0 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
