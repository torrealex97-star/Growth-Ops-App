import crypto from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { accessTokenFromRefresh } from '@/lib/google/ga4'
import { googleCredentials } from '@/lib/google/oauth'
import { defaultQuery, getAttachmentBytes, getMessage, listMessageIds } from '@/lib/gmail/client'

export const runtime = 'nodejs'
export const maxDuration = 60

// Importa facturas adjuntas del buzón de Gmail al banco de facturas.
//
// NADA ENTRA EN CONTABILIDAD SOLO. Todo aterriza en estado 'pendiente_validacion' y sin gasto
// vinculado — la constraint de la tabla lo impide incluso si el código se equivocara. Y no se extrae
// el importe: deducirlo del asunto o del nombre del archivo daría números plausibles y falsos, y el
// destino es la contabilidad.

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireManage(tenantSlug: string) {
  const session = await requireTenant(tenantSlug)
  if ('error' in session) return { ok: false as const, res: session.error }
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return {
      ok: false as const,
      res: NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 }),
    }
  }
  return { ok: true as const, session }
}

// GET — lista del buzón, por defecto lo pendiente de validar.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error

  const status = new URL(req.url).searchParams.get('status') || 'pendiente_validacion'
  const { data, error } = await serviceClient()
    .from('email_invoices')
    .select('id,from_email,subject,received_at,file_name,size_bytes,storage_path,status,expense_id,created_at')
    .eq('tenant_id', session.tenantId)
    .eq('status', status)
    .order('received_at', { ascending: false, nullsFirst: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

// POST — recorre el buzón e importa lo que falte. `dryRun` clasifica sin descargar ni escribir.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireManage(tenant)
  if (!auth.ok) return auth.res
  const { session } = auth
  const sb = serviceClient()

  const body = (await req.json().catch(() => ({}))) as { dias?: number; dryRun?: boolean }
  const dryRun = body.dryRun === true

  const { data: conn } = await sb
    .from('google_oauth_connections')
    .select('id,refresh_token,status')
    .eq('tenant_id', session.tenantId)
    .eq('provider', 'gmail')
    .maybeSingle()
  if (!conn) return NextResponse.json({ error: 'Gmail no está conectado en esta subcuenta' }, { status: 400 })

  const creds = await googleCredentials(session.tenantId)
  if (!creds) return NextResponse.json({ error: 'Faltan las credenciales de Google' }, { status: 400 })

  const c = conn as { id: string; refresh_token: string }
  const token = await accessTokenFromRefresh(c.refresh_token, creds)
  if ('error' in token) {
    await sb
      .from('google_oauth_connections')
      .update({ status: token.revoked ? 'revocada' : 'error', last_error: token.error })
      .eq('id', c.id)
    return NextResponse.json(
      {
        error: token.revoked
          ? 'Google ha revocado el acceso a Gmail. Hay que volver a conectar la cuenta.'
          : `No se pudo renovar el acceso: ${token.error}`,
      },
      { status: 400 }
    )
  }

  const query = defaultQuery(body.dias ?? 30)
  const stats = { mensajes: 0, adjuntos: 0, importadas: 0, ya_importadas: 0, duplicadas_por_contenido: 0, errores: 0 }
  const muestra: Array<{ de: string | null; asunto: string | null; archivo: string }> = []

  // Presupuesto de tiempo: el buzón puede ser enorme y descargar adjuntos es lento. Se para y se
  // informa de que quedan, en vez de que la función muera a medias.
  const deadline = Date.now() + 45_000
  let pageToken: string | undefined
  let vueltas = 0

  while (vueltas < 20 && Date.now() < deadline) {
    const page = await listMessageIds({ accessToken: token.token, query, pageToken })
    if ('error' in page) return NextResponse.json({ error: page.error, ...stats }, { status: 400 })

    for (const messageId of page.ids) {
      if (Date.now() > deadline) break
      stats.mensajes++
      const msg = await getMessage(token.token, messageId)
      if ('error' in msg) {
        stats.errores++
        continue
      }
      for (const att of msg.attachments) {
        if (Date.now() > deadline) break
        stats.adjuntos++

        // ¿Esta ocurrencia ya está? Se comprueba ANTES de descargar: evita gastar tiempo y cuota de
        // la API bajando un archivo que ya se tiene.
        const { data: yaEsta } = await sb
          .from('email_invoices')
          .select('id')
          .eq('tenant_id', session.tenantId)
          .eq('provider', 'gmail')
          .eq('message_id', att.messageId)
          .eq('attachment_id', att.attachmentId)
          .maybeSingle()
        if (yaEsta) {
          stats.ya_importadas++
          continue
        }

        if (muestra.length < 10) muestra.push({ de: att.fromEmail, asunto: att.subject, archivo: att.fileName })
        if (dryRun) continue

        const bytes = await getAttachmentBytes(token.token, att.messageId, att.attachmentId)
        if ('error' in bytes) {
          stats.errores++
          continue
        }
        const sha256 = crypto.createHash('sha256').update(bytes.bytes).digest('hex')

        // El MISMO contenido puede llegar por otro mensaje (el proveedor manda la factura y el gestor
        // la reenvía). Es una sola factura: contarla dos veces sería un error de dinero.
        const { data: mismoContenido } = await sb
          .from('email_invoices')
          .select('id')
          .eq('tenant_id', session.tenantId)
          .eq('sha256', sha256)
          .maybeSingle()
        if (mismoContenido) {
          stats.duplicadas_por_contenido++
          continue
        }

        const path = `${session.tenantId}/email/${sha256.slice(0, 12)}-${att.fileName.replace(/[^\w.\-]+/g, '_').slice(-80)}`
        const up = await sb.storage
          .from('facturas')
          .upload(path, bytes.bytes, { contentType: att.mimeType, upsert: true })
        if (up.error) {
          stats.errores++
          continue
        }

        const { data: inserted, error } = await sb
          .from('email_invoices')
          .insert({
            tenant_id: session.tenantId,
            provider: 'gmail',
            message_id: att.messageId,
            attachment_id: att.attachmentId,
            sha256,
            from_email: att.fromEmail,
            subject: att.subject,
            received_at: att.receivedAt,
            file_name: att.fileName,
            mime_type: att.mimeType,
            size_bytes: bytes.bytes.length,
            storage_path: path,
            // status por defecto: 'pendiente_validacion'. No se pone aquí a propósito, para que sea
            // la base quien decida y nadie pueda "colar" una validada desde el sync.
          })
          .select('id')
        if (error) {
          // 23505 = la carrera la resolvió el índice único: es el mismo caso "ya estaba".
          if (error.code === '23505') stats.duplicadas_por_contenido++
          else stats.errores++
          continue
        }
        if (inserted && inserted.length > 0) stats.importadas++
        else stats.errores++
      }
    }

    vueltas++
    pageToken = page.nextPageToken ?? undefined
    if (!pageToken) break
  }

  if (!dryRun) {
    await sb
      .from('google_oauth_connections')
      .update({ last_sync_at: new Date().toISOString(), status: 'conectada', last_error: null })
      .eq('id', c.id)
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    consulta: query,
    ...stats,
    quedan_por_revisar: !!pageToken,
    muestra,
  })
}

// PATCH — validar o descartar. Vincular a un gasto solo es posible al validar, nunca antes.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireManage(tenant)
  if (!auth.ok) return auth.res
  const { session } = auth

  const body = (await req.json().catch(() => ({}))) as {
    id?: string
    status?: string
    expenseId?: string | null
    notes?: string
  }
  if (!body.id) return NextResponse.json({ error: 'Falta el id' }, { status: 400 })
  if (!body.status || !['validada', 'descartada'].includes(body.status)) {
    return NextResponse.json({ error: 'El estado debe ser validada o descartada' }, { status: 400 })
  }

  const { data, error } = await serviceClient()
    .from('email_invoices')
    .update({
      status: body.status,
      validated_by: session.userId,
      validated_at: new Date().toISOString(),
      // Solo se vincula el gasto al VALIDAR: descartar no puede dejar un gasto atado.
      expense_id: body.status === 'validada' ? body.expenseId || null : null,
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    })
    .eq('tenant_id', session.tenantId)
    .eq('id', body.id)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'No se encontró esa factura en esta subcuenta' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
