// Piezas compartidas del flujo OAuth con Google.
import { getTenantConfigWithFallback } from '@/lib/config'

/**
 * Ámbitos por servicio. TODOS de solo lectura: esta app nunca necesita escribir en la analítica ni
 * en el correo del cliente, y pedir un permiso que no se usa es una responsabilidad gratuita — si
 * la app se ve comprometida, el alcance del daño es lo que se concedió, no lo que se usaba.
 */
export const SCOPES: Record<'ga4' | 'gmail', string[]> = {
  ga4: ['https://www.googleapis.com/auth/analytics.readonly'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.metadata'],
}

/**
 * URI de redirección. Tiene que coincidir EXACTAMENTE con la registrada en Google Cloud, incluido el
 * esquema y sin barra final: Google compara la cadena, no la URL semánticamente.
 *
 * No lleva la subcuenta en la ruta a propósito — Google exige registrar cada URI una a una, así que
 * un callback por subcuenta obligaría a editar la consola cada vez que se crea una. La subcuenta
 * viaja firmada en `state` (ver lib/google/oauth-state.ts).
 */
export function redirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/api/oauth/google/callback`
}

export type GoogleCredentials = { clientId: string; clientSecret: string }

/** Credenciales del proyecto de Google Cloud, guardadas cifradas por subcuenta. */
export async function googleCredentials(tenantId: string): Promise<GoogleCredentials | null> {
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  const clientId = cfg.GOOGLE_CLIENT_ID
  const clientSecret = cfg.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function authorizationUrl(opts: { clientId: string; scopes: string[]; state: string }): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', opts.scopes.join(' '))
  // offline + consent: sin esto Google NO devuelve refresh_token en las autorizaciones posteriores a
  // la primera, y la conexión dejaría de funcionar en cuanto caducara el access token.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', opts.state)
  return url.toString()
}

export type TokenResponse = {
  access_token?: string
  refresh_token?: string
  scope?: string
  expires_in?: number
  error?: string
  error_description?: string
}

export async function exchangeCode(code: string, creds: GoogleCredentials): Promise<TokenResponse> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  return (await r.json().catch(() => ({}))) as TokenResponse
}

/** Email de la cuenta que autorizó, para que la pantalla diga de quién es la conexión. */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { email?: string }
    return j.email ?? null
  } catch {
    return null
  }
}
