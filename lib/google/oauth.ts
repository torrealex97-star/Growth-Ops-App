// Piezas compartidas del flujo OAuth con Google.
import { getTenantConfigWithFallback } from '@/lib/config'

/**
 * Ámbitos por servicio. TODOS de solo lectura: esta app nunca necesita escribir en la analítica ni
 * en el correo del cliente, y pedir un permiso que no se usa es una responsabilidad gratuita — si
 * la app se ve comprometida, el alcance del daño es lo que se concedió, no lo que se usaba.
 */
export type GoogleProvider = 'ga4' | 'gmail' | 'calendar' | 'youtube'

export const SCOPES: Record<GoogleProvider, string[]> = {
  ga4: ['https://www.googleapis.com/auth/analytics.readonly'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.metadata'],
  // Calendar empieza deliberadamente en solo lectura. calendarlist.readonly permite que el closer
  // elija su calendario principal y los de conflicto; events.readonly permite conciliarlos. El
  // write-back exigirá una autorización incremental separada cuando exista esa función.
  calendar: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
  ],
  // YouTube necesita upload para publicar Shorts y readonly para sincronizar sus métricas. Se pide
  // en un consentimiento separado: conectar Calendar no debe conceder acceso al canal.
  youtube: [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
  ],
}

/**
 * URI de redirección. Tiene que coincidir EXACTAMENTE con la registrada en Google Cloud, incluido el
 * esquema y sin barra final: Google compara la cadena, no la URL semánticamente.
 *
 * No lleva la subcuenta en la ruta a propósito — Google exige registrar cada URI una a una, así que
 * un callback por subcuenta obligaría a editar la consola cada vez que se crea una. La subcuenta
 * viaja firmada en `state` (ver lib/google/oauth-state.ts).
 */
export function googleRedirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/api/oauth/google/callback`
}

export type GoogleCredentials = { clientId: string; clientSecret: string }

/** Credenciales del proyecto de Google Cloud, guardadas cifradas por subcuenta. */
export async function googleCredentials(
  tenantId: string,
  provider: GoogleProvider = 'ga4'
): Promise<GoogleCredentials | null> {
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  // YouTube mantiene compatibilidad con sus credenciales históricas. El resto usa el cliente
  // común de Google; en ambos casos la persona solo pulsa OAuth y el secreto nunca pasa al browser.
  const clientId = provider === 'youtube' ? cfg.YOUTUBE_CLIENT_ID : cfg.GOOGLE_CLIENT_ID
  const clientSecret = provider === 'youtube' ? cfg.YOUTUBE_CLIENT_SECRET : cfg.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function authorizationUrl(opts: { clientId: string; scopes: string[]; state: string }): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', googleRedirectUri())
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

/**
 * Intercambia el código de autorización por tokens. `redirectUriOverride` debe ser exactamente la
 * URI usada al pedir la autorización (Google la compara como cadena): los clientes OAuth que solo
 * tienen el playground registrado (YouTube de las subcuentas) exigen este override.
 */
export async function exchangeCode(
  code: string,
  creds: GoogleCredentials,
  redirectUriOverride?: string
): Promise<TokenResponse> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUriOverride || googleRedirectUri(),
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
