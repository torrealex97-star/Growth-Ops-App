import type { MetaOAuthSurface } from './oauth-state'
import { graphUrl, META_API_VERSION } from './api-version'

export const META_OAUTH_SCOPES: Record<MetaOAuthSurface, string[]> = {
  meta: ['ads_read'],
  instagram: ['instagram_basic', 'instagram_manage_insights', 'pages_show_list', 'pages_read_engagement'],
}

export function metaRedirectUri(): string {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL || 'https://app.scalixsystems.com').replace(/\/$/, '')
  return `${origin}/api/oauth/meta/callback`
}

export function metaAuthorizationUrl(input: { appId: string; surface: MetaOAuthSurface; state: string }): string {
  const url = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`)
  url.searchParams.set('client_id', input.appId)
  url.searchParams.set('redirect_uri', metaRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', input.state)
  url.searchParams.set('scope', META_OAUTH_SCOPES[input.surface].join(','))
  return url.toString()
}

type TokenResponse = { access_token?: string; token_type?: string; expires_in?: number; error?: { message?: string } }

async function graphToken(params: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(`${graphUrl(META_API_VERSION, 'oauth/access_token')}?${params}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json' },
  })
  const body = (await response.json().catch(() => ({}))) as TokenResponse
  if (!response.ok || body.error) throw new Error(body.error?.message || `Meta OAuth respondió ${response.status}`)
  return body
}

export async function exchangeMetaCode(code: string, appId: string, appSecret: string): Promise<TokenResponse> {
  const short = await graphToken(
    new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: metaRedirectUri(), code })
  )
  if (!short.access_token) throw new Error('Meta no devolvió access token')
  // El token corto sirve unas horas. La app necesita sincronizar sin que el usuario esté delante,
  // por eso solo consideramos completa la conexión si Meta entrega el token de larga duración.
  return graphToken(
    new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: short.access_token,
    })
  )
}

export type InstagramBusinessAccount = { id: string; username?: string; pageId: string }

export async function discoverInstagramBusinessAccounts(accessToken: string): Promise<InstagramBusinessAccount[]> {
  const url = new URL(graphUrl(META_API_VERSION, 'me/accounts'))
  url.searchParams.set('fields', 'id,instagram_business_account{id,username}')
  url.searchParams.set('limit', '100')
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  })
  const body = (await response.json().catch(() => ({}))) as {
    data?: Array<{ id?: string; instagram_business_account?: { id?: string; username?: string } }>
  }
  if (!response.ok) return []
  return (body.data || []).flatMap((page) => {
    const account = page.instagram_business_account
    if (!page.id || !account?.id) return []
    return [{ id: account.id, username: account.username, pageId: page.id }]
  })
}
