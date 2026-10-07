import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { resolveTenantBranding } from '@/lib/tenant-branding'

export const runtime = 'nodejs'

const BUCKET = 'carrusel-uploads'
const MAX_LOGO_BYTES = 4 * 1024 * 1024
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function saveLogoUrl(tenantId: string, logoUrl: string | null, actorUserId: string) {
  const sb = serviceClient()
  const { data, error: readError } = await sb.from('tenants').select('settings').eq('id', tenantId).single()
  if (readError) throw new Error(readError.message)

  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {}
  const currentBranding =
    'branding' in settings && settings.branding && typeof settings.branding === 'object' ? settings.branding : {}
  const previousLogoUrl =
    'logo_url' in currentBranding && typeof currentBranding.logo_url === 'string' ? currentBranding.logo_url : null
  const nextSettings = { ...settings, branding: { ...currentBranding, logo_url: logoUrl } }
  const { error: updateError } = await sb.from('tenants').update({ settings: nextSettings }).eq('id', tenantId)
  if (updateError) throw new Error(updateError.message)

  const { error: auditError } = await sb.from('audit_logs').insert({
    tenant_id: tenantId,
    entity_type: 'tenant_branding',
    entity_id: tenantId,
    action: logoUrl ? 'logo_update' : 'logo_remove',
    actor_user_id: actorUserId,
    new_values: { logo_configured: Boolean(logoUrl) },
  })
  if (auditError) console.error('[settings/branding] cambio sin auditoría:', auditError.message)

  return { branding: resolveTenantBranding(nextSettings), previousLogoUrl }
}

function hasValidSignature(bytes: Uint8Array, mime: string) {
  if (mime === 'image/png')
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/webp')
    return (
      Buffer.from(bytes.slice(0, 4)).toString('ascii') === 'RIFF' &&
      Buffer.from(bytes.slice(8, 12)).toString('ascii') === 'WEBP'
    )
  return false
}

function storageKey(publicUrl: string | null) {
  if (!publicUrl) return null
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const position = publicUrl.indexOf(marker)
  return position >= 0 ? decodeURIComponent(publicUrl.slice(position + marker.length)) : null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!auth.administraTenant) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Selecciona una imagen' }, { status: 400 })
  const extension = EXTENSIONS[file.type]
  if (!extension) return NextResponse.json({ error: 'Usa una imagen PNG, JPG o WebP' }, { status: 400 })
  if (!file.size || file.size > MAX_LOGO_BYTES) {
    return NextResponse.json({ error: 'El logo debe ocupar entre 1 byte y 4 MB' }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!hasValidSignature(bytes, file.type)) {
    return NextResponse.json({ error: 'El contenido del archivo no coincide con su formato' }, { status: 400 })
  }

  const sb = serviceClient()
  const key = `${tenant}/tenant-logo/${crypto.randomUUID()}.${extension}`
  const { error: uploadError } = await sb.storage.from(BUCKET).upload(key, Buffer.from(bytes), {
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) return NextResponse.json({ error: 'No se pudo subir el logo' }, { status: 500 })

  try {
    const { data } = sb.storage.from(BUCKET).getPublicUrl(key)
    const { branding, previousLogoUrl } = await saveLogoUrl(auth.tenantId, data.publicUrl, auth.userId)
    const previousKey = storageKey(previousLogoUrl)
    if (previousKey) {
      const { error: removeError } = await sb.storage.from(BUCKET).remove([previousKey])
      if (removeError) console.error('[settings/branding] logo anterior no eliminado:', removeError.message)
    }
    return NextResponse.json({ branding })
  } catch (error) {
    await sb.storage.from(BUCKET).remove([key])
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo guardar el logo' },
      { status: 500 }
    )
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!auth.administraTenant) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  try {
    const { branding, previousLogoUrl } = await saveLogoUrl(auth.tenantId, null, auth.userId)
    const previousKey = storageKey(previousLogoUrl)
    if (previousKey) {
      const { error: removeError } = await serviceClient().storage.from(BUCKET).remove([previousKey])
      if (removeError)
        console.error('[settings/branding] logo eliminado del perfil pero no del storage:', removeError.message)
    }
    return NextResponse.json({ branding })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo quitar el logo' },
      { status: 500 }
    )
  }
}
