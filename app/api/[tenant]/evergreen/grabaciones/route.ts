import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { categorizeByMime } from '@/lib/recordings/categorize'

export const runtime = 'nodejs'

// Banco de grabaciones. El ARCHIVO no pasa por aquí: el navegador lo sube directo al bucket privado
// con su propia sesión (las políticas de storage.objects validan el prefijo tenant_id/), y este
// endpoint registra la fila. Así una subida masiva de archivos grandes no choca con el límite de
// cuerpo de una función serverless ni la mantiene ocupada mientras suben megas.

function serviceClient() {
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

// GET — lista del banco, con filtro opcional por estado.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const session = await requireTenant(tenant)
    if ('error' in session) return session.error

    const status = new URL(req.url).searchParams.get('status')
    let q = serviceClient()
      .from('call_recordings')
      .select('id,file_name,mime_type,size_bytes,category,status,storage_path,appointment_id,created_at,notes')
      .eq('tenant_id', session.tenantId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (status && ['pendiente', 'aprobada', 'rechazada'].includes(status)) q = q.eq('status', status)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ items: data ?? [] })
  } catch (err) {
    console.error('[api/grabaciones GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// POST — registra un archivo ya subido al bucket. Idempotente por (tenant_id, sha256): reintentar
// una subida masiva interrumpida no duplica lo que ya estaba.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireManage(tenant)
    if (!auth.ok) return auth.res
    const { session } = auth

    const body = (await req.json().catch(() => ({}))) as {
      storagePath?: string
      fileName?: string
      mimeType?: string
      sizeBytes?: number
      sha256?: string
      appointmentId?: string | null
    }

    const sha256 = (body.sha256 || '').trim().toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      return NextResponse.json({ error: 'Falta el hash SHA-256 del contenido o no es válido' }, { status: 400 })
    }
    const category = categorizeByMime(body.mimeType)
    if (!category) {
      return NextResponse.json(
        { error: `Tipo de archivo no admitido: ${body.mimeType || 'desconocido'}` },
        { status: 400 }
      )
    }
    const sizeBytes = Number(body.sizeBytes)
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return NextResponse.json({ error: 'El tamaño del archivo no es válido' }, { status: 400 })
    }
    const storagePath = (body.storagePath || '').trim()
    // La ruta TIENE que empezar por el tenant_id de la sesión: es lo que hace cumplir el aislamiento
    // en Storage, y aceptar una ruta arbitraria dejaría registrar un archivo de otra subcuenta.
    if (!storagePath.startsWith(`${session.tenantId}/`)) {
      return NextResponse.json({ error: 'La ruta del archivo no pertenece a esta subcuenta' }, { status: 400 })
    }

    const sb = serviceClient()

    // ¿Ya estaba? Se responde 200 con `duplicado: true` en vez de un error: para quien sube en lote,
    // "ya lo tenías" no es un fallo que deba reintentar.
    const existing = await sb
      .from('call_recordings')
      .select('id,file_name')
      .eq('tenant_id', session.tenantId)
      .eq('sha256', sha256)
      .maybeSingle()
    if (existing.data) {
      return NextResponse.json({ duplicado: true, id: (existing.data as { id: string }).id })
    }

    const { data, error } = await sb
      .from('call_recordings')
      .insert({
        tenant_id: session.tenantId,
        storage_path: storagePath,
        file_name: body.fileName || storagePath.split('/').pop() || 'sin-nombre',
        mime_type: body.mimeType,
        size_bytes: Math.trunc(sizeBytes),
        sha256,
        category,
        appointment_id: body.appointmentId || null,
        uploaded_by: session.userId,
      })
      .select('id')
      .single()

    // Una carrera entre dos subidas del mismo archivo la resuelve el índice único, no el chequeo de
    // arriba: si salta, es el mismo caso "ya estaba".
    if (error) {
      if (error.code === '23505') return NextResponse.json({ duplicado: true })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, id: (data as { id: string }).id, category })
  } catch (err) {
    console.error('[api/grabaciones POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// PATCH — aprobar o rechazar. La aprobación es MANUAL a propósito: es material con voz de clientes
// reales, no se usa por haberse subido.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireManage(tenant)
    if (!auth.ok) return auth.res
    const { session } = auth

    const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string; notes?: string }
    if (!body.id) return NextResponse.json({ error: 'Falta el id' }, { status: 400 })
    if (!body.status || !['aprobada', 'rechazada'].includes(body.status)) {
      return NextResponse.json({ error: 'El estado debe ser aprobada o rechazada' }, { status: 400 })
    }

    const { data, error } = await serviceClient()
      .from('call_recordings')
      .update({
        status: body.status,
        reviewed_by: session.userId,
        reviewed_at: new Date().toISOString(),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      })
      .eq('tenant_id', session.tenantId)
      .eq('id', body.id)
      .select('id')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // 0 filas sin error = la grabación no es de esta subcuenta o ya no existe. No se reporta éxito.
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'No se encontró esa grabación en esta subcuenta' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/grabaciones PATCH]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
