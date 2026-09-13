// Cliente de la API de Gmail, solo lectura.
//
// QUÉ HACE Y QUÉ NO HACE, dicho antes que nada: importa el ARCHIVO y los metadatos verificables del
// correo (remitente, asunto, fecha, nombre, tamaño, tipo). **NO extrae el importe, la base imponible
// ni el CIF del proveedor.** Deducir eso del nombre del archivo o del asunto produce números
// plausibles y falsos, y aquí el destino es la contabilidad: un importe inventado que parece bueno es
// peor que un campo vacío que obliga a mirar la factura. La validación la hace una persona.

export type GmailAttachment = {
  messageId: string
  attachmentId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  fromEmail: string | null
  subject: string | null
  receivedAt: string | null
}

/** Tipos que se consideran factura. Una imagen suelta o un calendario adjunto no lo son. */
const INVOICE_MIMES = new Set(['application/pdf'])

export function isInvoiceAttachment(mimeType: string | null | undefined, fileName: string): boolean {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim()
  if (INVOICE_MIMES.has(mime)) return true
  // Algunos proveedores mandan el PDF con un MIME genérico. Se acepta solo si además la extensión
  // dice .pdf: el MIME manda, y la extensión únicamente rescata este caso conocido.
  return mime === 'application/octet-stream' && /\.pdf$/i.test(fileName.trim())
}

type GmailHeader = { name?: string; value?: string }
type GmailPart = {
  filename?: string
  mimeType?: string
  body?: { attachmentId?: string; size?: number }
  parts?: GmailPart[]
}

function header(headers: GmailHeader[] | undefined, name: string): string | null {
  const h = (headers ?? []).find((x) => (x.name || '').toLowerCase() === name.toLowerCase())
  return h?.value?.trim() || null
}

/** "Nombre Apellido <correo@dominio.com>" → "correo@dominio.com". */
export function parseFromEmail(raw: string | null): string | null {
  if (!raw) return null
  const m = /<([^>]+)>/.exec(raw)
  const value = (m ? m[1] : raw).trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null
}

export type GmailMessage = {
  id?: string
  internalDate?: string
  payload?: {
    headers?: GmailHeader[]
    parts?: GmailPart[]
    filename?: string
    mimeType?: string
    body?: { attachmentId?: string; size?: number }
  }
}

/** Recorre el árbol de partes del mensaje, que puede anidarse varios niveles. */
export function collectAttachments(message: GmailMessage): GmailAttachment[] {
  const messageId = message.id
  if (!messageId) return []
  const headers = message.payload?.headers
  const fromEmail = parseFromEmail(header(headers, 'From'))
  const subject = header(headers, 'Subject')
  // internalDate viene en milisegundos como cadena.
  const ms = Number(message.internalDate)
  const receivedAt = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null

  const out: GmailAttachment[] = []
  const walk = (part: GmailPart | undefined) => {
    if (!part) return
    const fileName = (part.filename || '').trim()
    const attachmentId = part.body?.attachmentId
    const size = Number(part.body?.size)
    if (fileName && attachmentId && Number.isFinite(size) && size > 0 && isInvoiceAttachment(part.mimeType, fileName)) {
      out.push({
        messageId,
        attachmentId,
        fileName,
        mimeType: (part.mimeType || 'application/pdf').split(';')[0].trim(),
        sizeBytes: size,
        fromEmail,
        subject,
        receivedAt,
      })
    }
    for (const child of part.parts ?? []) walk(child)
  }
  walk(message.payload)
  for (const part of message.payload?.parts ?? []) walk(part)

  // Un mismo adjunto puede aparecer dos veces al recorrer payload y payload.parts: se deduplica por
  // attachmentId antes de devolverlo, para no intentar importarlo dos veces en la misma pasada.
  const seen = new Set<string>()
  return out.filter((a) => (seen.has(a.attachmentId) ? false : (seen.add(a.attachmentId), true)))
}

export async function listMessageIds(opts: {
  accessToken: string
  query: string
  pageToken?: string
}): Promise<{ ids: string[]; nextPageToken: string | null } | { error: string }> {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  url.searchParams.set('q', opts.query)
  url.searchParams.set('maxResults', '100')
  if (opts.pageToken) url.searchParams.set('pageToken', opts.pageToken)
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
    signal: AbortSignal.timeout(20_000),
  })
  const j = (await r.json().catch(() => ({}))) as {
    messages?: Array<{ id?: string }>
    nextPageToken?: string
    error?: { message?: string }
  }
  if (!r.ok) return { error: j.error?.message || `Gmail respondió ${r.status}` }
  return {
    ids: (j.messages ?? []).map((m) => m.id).filter((id): id is string => !!id),
    nextPageToken: j.nextPageToken ?? null,
  }
}

export async function getMessage(
  accessToken: string,
  messageId: string
): Promise<{ attachments: GmailAttachment[] } | { error: string }> {
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000) }
  )
  const j = (await r.json().catch(() => ({}))) as GmailMessage & { error?: { message?: string } }
  if (!r.ok) return { error: j.error?.message || `Gmail respondió ${r.status}` }
  return { attachments: collectAttachments(j) }
}

export async function getAttachmentBytes(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<{ bytes: Buffer } | { error: string }> {
  const r = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(30_000) }
  )
  const j = (await r.json().catch(() => ({}))) as { data?: string; error?: { message?: string } }
  if (!r.ok || !j.data) return { error: j.error?.message || `Gmail respondió ${r.status}` }
  // Gmail devuelve base64url, no base64 estándar.
  return { bytes: Buffer.from(j.data, 'base64url') }
}

/**
 * Consulta por defecto del buzón. Acota a correos CON adjunto para no recorrer el buzón entero, y
 * excluye lo enviado por uno mismo. `newer_than` se calcula según los días pedidos.
 */
export function defaultQuery(days: number): string {
  const d = Math.max(1, Math.min(Math.trunc(days) || 30, 365))
  return `has:attachment filename:pdf -in:sent newer_than:${d}d`
}
