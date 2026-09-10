// ============================================================
// Worker de transcripción de llamadas — [tenant]
// Flujo: Supabase (appointments.transcript_status='pendiente' + transcript_drive_url)
//   → descarga de Drive (service account o público)
//   → ffmpeg: audio 16kHz mono 24kbps troceado en segmentos de 10 min (<25MB c/u)
//   → Groq Whisper large-v3-turbo por trozo → une transcripción
//   → Claude: valoración llamada/lead + etapa + tareas
//   → guarda en Supabase + crea tareas al comercial
// Sin límite de duración. 100% dentro del tier gratuito de Groq.
// ============================================================
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import ffmpegPath from 'ffmpeg-static'
import { google } from 'googleapis'
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const {
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GROQ_API_KEY,
  ANTHROPIC_API_KEY,
  GOOGLE_SERVICE_ACCOUNT_JSON,
  POLL_INTERVAL_MS = '20000',
} = process.env

if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GROQ_API_KEY || !ANTHROPIC_API_KEY) {
  console.error('Faltan env vars obligatorias (SUPABASE_URL/SERVICE_ROLE/GROQ/ANTHROPIC)')
  process.exit(1)
}

const sb = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// ---- Google Drive (service account opcional) ----
let driveClient = null
if (GOOGLE_SERVICE_ACCOUNT_JSON) {
  try {
    const creds = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON)
    const auth = new google.auth.JWT(creds.client_email, undefined, creds.private_key, [
      'https://www.googleapis.com/auth/drive.readonly',
    ])
    driveClient = google.drive({ version: 'v3', auth })
    console.log('Drive: usando service account', creds.client_email)
  } catch (e) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON inválido:', e.message)
  }
} else {
  console.log('Drive: sin service account → solo archivos públicos ("cualquiera con el enlace")')
}

const driveFileId = (url) => (url.match(/\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/) || [])[1] || null

// Descarga el archivo de Drive a destPath
async function downloadDrive(fileId, destPath) {
  if (driveClient) {
    const res = await driveClient.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' })
    await new Promise((resolve, reject) => {
      const out = createWriteStream(destPath)
      res.data.on('error', reject).pipe(out).on('finish', resolve).on('error', reject)
    })
    return
  }
  // Público: uc?export=download con manejo de confirm-token
  const isBinary = (ct) => ct && !ct.includes('text/html') && !ct.includes('application/json')
  let r = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, { redirect: 'follow' })
  let ct = r.headers.get('content-type') || ''
  if (!(r.ok && isBinary(ct))) {
    const html = await r.text()
    if (/can't download|no se puede|sign in|request access|need access|denied/i.test(html)) {
      throw new Error("El archivo de Drive no es público. Compártelo como 'Cualquiera con el enlace' (Lector) o da acceso al service account.")
    }
    const action = (html.match(/action="([^"]+download[^"]*)"/) || [])[1]?.replace(/&amp;/g, '&')
    const params = new URLSearchParams()
    for (const m of html.matchAll(/name="([^"]+)"\s+value="([^"]*)"/g)) params.set(m[1], m[2])
    const url2 = action ? `${action}?${params.toString()}` : `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`
    r = await fetch(url2)
    ct = r.headers.get('content-type') || ''
    if (!(r.ok && isBinary(ct))) throw new Error('No se pudo descargar el archivo de Drive (¿es público y es audio/vídeo?).')
  }
  const buf = Buffer.from(await r.arrayBuffer())
  await (await import('node:fs/promises')).writeFile(destPath, buf)
}

// ffmpeg: extrae audio, 16kHz mono 24kbps, troceado en segmentos de 600s
function makeChunks(inputPath, outDir) {
  return new Promise((resolve, reject) => {
    const outPattern = path.join(outDir, 'chunk_%03d.mp3')
    const args = ['-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '24k',
      '-f', 'segment', '-segment_time', '600', '-reset_timestamps', '1', outPattern, '-y']
    const p = spawn(ffmpegPath, args)
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error('ffmpeg falló: ' + err.slice(-500))))
    p.on('error', reject)
  })
}

async function transcribeChunk(filePath) {
  const data = await readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(data)], { type: 'audio/mpeg' }), path.basename(filePath))
  form.append('model', 'whisper-large-v3-turbo')
  form.append('language', 'es')
  form.append('response_format', 'json')
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, body: form,
  })
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return (await res.json()).text || ''
}

async function analyzeCall(transcript, leadName) {
  const system = `Eres un sales coach experto en alto ticket (academia de closing "[tenant]").
Analizas la transcripción de una llamada de ventas y devuelves SOLO un objeto JSON:
{"call_score": number 1-10, "lead_score": number 1-10, "suggested_stage": one of ["Nuevo","Contactado","Cita agendada","Presentado/Demo","Oferta hecha","Depósito","Cerrado ganado","Seguimiento","Perdido/No cualifica"], "summary": string (3-4 frases en español), "objections": string[], "next_steps": string[], "tasks": [{"title": string, "description": string}]}
No inventes; si la transcripción es pobre, refléjalo en los scores.`
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-5', max_tokens: 1500, system,
    messages: [{ role: 'user', content: `${leadName ? `Lead: ${leadName}\n` : ''}Transcripción:\n"""${transcript.slice(0, 120000)}"""` }],
  })
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  const s = text.indexOf('{'), e = text.lastIndexOf('}')
  if (s === -1 || e === -1) throw new Error('La IA no devolvió JSON')
  return JSON.parse(text.slice(s, e + 1))
}

async function processOne(appt) {
  const id = appt.id
  console.log(`[${id}] procesando…`)
  await sb.from('appointments').update({ transcript_status: 'procesando' }).eq('id', id)
  const fileId = driveFileId(appt.transcript_drive_url || '')
  if (!fileId) throw new Error('Enlace de Drive no válido')

  const dir = await mkdtemp(path.join(tmpdir(), 'iaw-'))
  try {
    const input = path.join(dir, 'input.bin')
    await downloadDrive(fileId, input)
    await makeChunks(input, dir)
    const chunks = (await readdir(dir)).filter((f) => f.startsWith('chunk_')).sort()
    if (!chunks.length) throw new Error('No se generó audio (¿archivo sin pista de audio?)')
    console.log(`[${id}] ${chunks.length} trozos`)
    let transcript = ''
    for (const c of chunks) {
      const t = await transcribeChunk(path.join(dir, c))
      transcript += (transcript ? ' ' : '') + t.trim()
    }
    if (transcript.trim().length < 20) throw new Error('Transcripción vacía')

    const contact = appt.contacts || {}
    const analysis = await analyzeCall(transcript, contact.full_name)

    await sb.from('appointments').update({
      transcript, transcript_status: 'listo',
      ai_call_score: analysis.call_score, ai_lead_score: analysis.lead_score,
      ai_suggested_stage: analysis.suggested_stage, ai_summary: analysis.summary,
      ai_analysis: { objections: analysis.objections, next_steps: analysis.next_steps },
      ai_analyzed_at: new Date().toISOString(),
    }).eq('id', id)

    // Generación automática de tareas DESACTIVADA (pendiente de entrenamiento).
    console.log(`[${id}] LISTO — ${chunks.length} trozos (tareas automáticas desactivadas)`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function tick() {
  const { data, error } = await sb
    .from('appointments')
    .select('id, transcript_drive_url, closer_id, setter_id, contacts(full_name)')
    .eq('transcript_status', 'pendiente')
    .not('transcript_drive_url', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(1)
  if (error) { console.error('poll error:', error.message); return }
  if (!data?.length) return
  const appt = data[0]
  try {
    await processOne(appt)
  } catch (e) {
    console.error(`[${appt.id}] ERROR:`, e.message)
    await sb.from('appointments').update({ transcript_status: 'error', ai_summary: `Error: ${e.message}` }).eq('id', appt.id)
  }
}

console.log('Worker de transcripción [tenant] iniciado. Poll cada', POLL_INTERVAL_MS, 'ms')
async function loop() {
  for (;;) {
    try { await tick() } catch (e) { console.error('tick fatal:', e.message) }
    await new Promise((r) => setTimeout(r, Number(POLL_INTERVAL_MS)))
  }
}
loop()
