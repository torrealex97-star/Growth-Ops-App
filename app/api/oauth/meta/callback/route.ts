import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { encryptSecret, getTenantConfigWithFallback, invalidateConfigCache } from '@/lib/config'
import { discoverInstagramBusinessAccounts, exchangeMetaCode } from '@/lib/meta/oauth'
import { verifyMetaState, type MetaOAuthSurface } from '@/lib/meta/oauth-state'

export const runtime = 'nodejs'

function back(req: NextRequest, tenant: string, surface: MetaOAuthSurface, result: string, reason?: string) {
  const url = new URL(`/${tenant}/settings/integraciones`, req.nextUrl.origin)
  url.searchParams.set('meta_oauth', result)
  url.searchParams.set('servicio', surface)
  if (reason) url.searchParams.set('motivo', reason)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  try {
    const state = verifyMetaState(req.nextUrl.searchParams.get('state'))
    if (!state.ok) {
      return NextResponse.json({ error: 'La autorización no es válida o ha caducado.' }, { status: 400 })
    }
    const { tenant, surface, userId } = state.payload
    const session = await requireTenant(tenant)
    if ('error' in session) return session.error
    if (session.userId !== userId)
      return NextResponse.json({ error: 'La autorización no pertenece a esta sesión.' }, { status: 403 })
    if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
      return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
    }
    if (req.nextUrl.searchParams.get('error')) return back(req, tenant, surface, 'cancelada')
    const code = req.nextUrl.searchParams.get('code')
    if (!code) return back(req, tenant, surface, 'error', 'sin_codigo')

    const cfg = await getTenantConfigWithFallback(session.tenantId)
    const appId = String(cfg.META_APP_ID || '').trim()
    const appSecret = String(cfg.META_APP_SECRET || '').trim()
    if (!appId || !appSecret) return back(req, tenant, surface, 'error', 'sin_credenciales')

    const token = await exchangeMetaCode(code, appId, appSecret)
    if (!token.access_token) return back(req, tenant, surface, 'error', 'sin_token')
    const key = surface === 'meta' ? 'META_ACCESS_TOKEN' : 'INSTAGRAM_ACCESS_TOKEN'
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : ''
    const rows = [
      {
        tenant_id: session.tenantId,
        key,
        value: encryptSecret(token.access_token),
        is_secret: true,
        updated_by: userId,
      },
      {
        tenant_id: session.tenantId,
        key: surface === 'meta' ? 'META_TOKEN_EXPIRES_AT' : 'INSTAGRAM_TOKEN_EXPIRES_AT',
        value: expiresAt,
        is_secret: false,
        updated_by: userId,
      },
    ]
    let instagramNeedsSelection = false
    if (surface === 'instagram') {
      const accounts = await discoverInstagramBusinessAccounts(token.access_token)
      if (accounts.length === 1) {
        const account = accounts[0]
        rows.push(
          { tenant_id: session.tenantId, key: 'IG_USER_ID', value: account.id, is_secret: false, updated_by: userId },
          {
            tenant_id: session.tenantId,
            key: 'IG_PAGE_ID',
            value: account.pageId,
            is_secret: false,
            updated_by: userId,
          },
          {
            tenant_id: session.tenantId,
            key: 'IG_HANDLE',
            value: account.username ? `@${account.username}` : '',
            is_secret: false,
            updated_by: userId,
          }
        )
      } else {
        // Cero o varias cuentas no se pueden resolver sin una decisión humana. Se conserva el token,
        // pero jamás se elige la primera por azar: eso podría mezclar métricas de otra marca.
        instagramNeedsSelection = true
      }
    }
    const { error } = await sb.from('integration_settings').upsert(rows, { onConflict: 'tenant_id,key' })
    if (error) return back(req, tenant, surface, 'error', 'no_se_pudo_guardar')
    invalidateConfigCache(session.tenantId)
    return back(req, tenant, surface, instagramNeedsSelection ? 'requiere_cuenta' : 'conectada')
  } catch (error) {
    console.error('[api/oauth/meta/callback GET]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
