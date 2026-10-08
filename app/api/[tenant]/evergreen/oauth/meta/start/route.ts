import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { metaAuthorizationUrl } from '@/lib/meta/oauth'
import { signMetaState, type MetaOAuthSurface } from '@/lib/meta/oauth-state'
import { isMetaAppId } from '@/lib/integrations/oauth-credentials'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
  }
  const surface = new URL(req.url).searchParams.get('surface')
  if (surface !== 'meta' && surface !== 'instagram') {
    return NextResponse.json({ error: 'Integración de Meta no válida' }, { status: 400 })
  }
  const cfg = await getTenantConfigWithFallback(session.tenantId)
  const appId = String(cfg.META_APP_ID || '').trim()
  const appSecret = String(cfg.META_APP_SECRET || '').trim()
  if (!isMetaAppId(appId) || !appSecret) {
    return NextResponse.json({ error: 'Guarda primero la App ID y el App Secret de Meta.' }, { status: 400 })
  }
  try {
    const state = signMetaState({ tenant, surface: surface as MetaOAuthSurface, userId: session.userId })
    return NextResponse.redirect(metaAuthorizationUrl({ appId, surface: surface as MetaOAuthSurface, state }))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo iniciar la autorización' },
      { status: 500 }
    )
  }
}
