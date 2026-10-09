/**
 * OAuth 2.1 del servidor MCP (RFC 6749 + PKCE RFC 7636 + registro dinámico RFC 7591).
 *
 * - Solo authorization_code + PKCE S256 (OAuth 2.1 prohíbe el flujo implícito y password).
 * - client_secret_http: como los clientes (ChatGPT, Claude) usan PKCE, el client_secret se
 *   valida en el canje del código pero NO se exige en el header del endpoint /token para
 *   clientes públicos; se acepta client_id + code_verifier.
 * - Códigos de 60 s y de UN SOLO uso (consumeCode hace UPDATE atómico sobre used_at).
 * - Access token JWT HS256 de 15 min con jti = hash del token en BD (revocable).
 * - Refresh rotativo de 30 días: cada canje revoca el anterior (revokeByRefreshHash).
 */
import { hashToken, randomToken, secretMatches, signJwt, verifyJwt } from './crypto'
import { consumeCode, findAccessToken, getClient, insertCode, insertToken, revokeByRefreshHash } from './store'

const CODE_TTL_S = 60
const ACCESS_TTL_S = 15 * 60
const REFRESH_TTL_S = 30 * 24 * 60 * 60

export const MCP_JWT_SECRET_ENV = 'MCP_JWT_SECRET'

export function jwtSecret(): string | null {
  const s = process.env[MCP_JWT_SECRET_ENV]
  return s && s.length >= 32 ? s : null
}

/** Verifica el code_verifier contra el code_challenge S256 guardado. */
export function verificarPkce(verifier: string, challenge: string): boolean {
  const expected = hashToken(verifier)
  // hashToken devuelve hex; challenge llega base64url. Se compara en base64url.
  const expectedB64 = Buffer.from(expected, 'hex').toString('base64url')
  return expectedB64 === challenge
}

export type AuthorizeOk = { ok: true; redirectUrl: string }
export type AuthorizeErr = { ok: false; redirectUrl: string }

/**
 * Valida una petición de autorización y devuelve la URL a la que redirigir tras el
 * consentimiento (o el error, también por redirect si redirect_uri es válida; si no, HTML).
 */
export async function validarAutorizacion(params: {
  response_type: string | null
  client_id: string | null
  redirect_uri: string | null
  code_challenge: string | null
  code_challenge_method: string | null
  scope: string | null
  state: string | null
}): Promise<{ error?: string; redirectUri?: string; state?: string | null; clientName?: string }> {
  const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method, state } = params
  if (response_type !== 'code') return { error: 'response_type debe ser "code" (OAuth 2.1)' }
  if (!client_id) return { error: 'Falta client_id' }
  const client = await getClient(client_id)
  if (!client) return { error: 'client_id desconocido' }
  if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) {
    return { error: 'redirect_uri no registrada para este cliente' }
  }
  if (!code_challenge) return { error: 'PKCE obligatorio: falta code_challenge' }
  if (code_challenge_method !== 'S256') return { error: 'code_challenge_method debe ser S256' }
  return { redirectUri: redirect_uri, state, clientName: client.name }
}

export async function emitirCodigo(input: {
  clientId: string
  userId: string
  redirectUri: string
  scope: string
  codeChallenge: string
}): Promise<string> {
  const code = randomToken(32)
  await insertCode({
    code_hash: hashToken(code),
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    scope: input.scope,
    code_challenge: input.codeChallenge,
    expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
  })
  return code
}

export type TokenGrantResult =
  | { ok: true; access_token: string; refresh_token: string; expires_in: number; token_type: 'Bearer'; scope: string }
  | { ok: false; error: string; status: number }

/** Canje de authorization_code (+PKCE) por tokens. */
export async function canjearCodigo(body: Record<string, unknown>): Promise<TokenGrantResult> {
  const code = typeof body.code === 'string' ? body.code : ''
  const clientId = typeof body.client_id === 'string' ? body.client_id : ''
  const redirectUri = typeof body.redirect_uri === 'string' ? body.redirect_uri : ''
  const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : ''
  const clientSecret = typeof body.client_secret === 'string' ? body.client_secret : ''

  if (!code || !clientId || !verifier) {
    return { ok: false, error: 'Faltan code, client_id o code_verifier', status: 400 }
  }
  const client = await getClient(clientId)
  if (!client) return { ok: false, error: 'client_id desconocido', status: 400 }

  // Secret obligatorio SOLO para clientes confidenciales (los que declaran secret). Con PKCE
  // los públicos canjea con client_id + verifier, como manda OAuth 2.1.
  if (client.client_secret_hash && clientSecret) {
    if (!secretMatches(clientSecret, client.client_secret_hash)) {
      return { ok: false, error: 'client_secret inválido', status: 401 }
    }
  }

  const data = await consumeCode(hashToken(code))
  if (!data) return { ok: false, error: 'Código inválido, caducado o ya usado', status: 400 }
  if (data.client_id !== clientId) return { ok: false, error: 'Código emitido para otro cliente', status: 400 }
  if (data.redirect_uri !== redirectUri)
    return { ok: false, error: 'redirect_uri distinta a la del código', status: 400 }
  if (!verificarPkce(verifier, data.code_challenge)) {
    return { ok: false, error: 'code_verifier no coincide con el challenge', status: 400 }
  }

  return emitirTokens({ clientId, userId: data.user_id, scope: data.scope })
}

/** Refresh con rotación: el token antiguo se revoca en la misma operación. */
export async function refrescarToken(body: Record<string, unknown>): Promise<TokenGrantResult> {
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  const clientId = typeof body.client_id === 'string' ? body.client_id : ''
  if (!refreshToken || !clientId) return { ok: false, error: 'Faltan refresh_token o client_id', status: 400 }
  const client = await getClient(clientId)
  if (!client) return { ok: false, error: 'client_id desconocido', status: 400 }

  const row = await revokeByRefreshHash(hashToken(refreshToken))
  if (!row) return { ok: false, error: 'Refresh token inválido o ya usado', status: 400 }
  if (row.refresh_expires_at && new Date(row.refresh_expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Refresh token caducado', status: 400 }
  }
  return emitirTokens({ clientId, userId: row.user_id, scope: row.scope })
}

async function emitirTokens(input: { clientId: string; userId: string; scope: string }): Promise<TokenGrantResult> {
  const secret = jwtSecret()
  if (!secret) return { ok: false, error: 'Servidor MCP sin MCP_JWT_SECRET configurado', status: 503 }

  const jti = randomToken(16)
  const accessToken = signJwt(
    { sub: input.userId, jti, scope: input.scope, typ: 'mcp_access', client_id: input.clientId },
    secret,
    ACCESS_TTL_S
  )
  const refreshToken = randomToken(32)
  await insertToken({
    token_hash: hashToken(accessToken),
    refresh_hash: hashToken(refreshToken),
    client_id: input.clientId,
    user_id: input.userId,
    scope: input.scope,
    expires_at: new Date(Date.now() + ACCESS_TTL_S * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + REFRESH_TTL_S * 1000).toISOString(),
  })
  return {
    ok: true,
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TTL_S,
    token_type: 'Bearer',
    scope: input.scope,
  }
}

/** Validación de Bearer: firma + jti presente en BD y no revocado. */
export async function validarAccessToken(
  token: string
): Promise<{ userId: string; email: string; clientId: string } | null> {
  const secret = jwtSecret()
  if (!secret) return null
  const claims = verifyJwt(token, secret)
  if (!claims || claims.typ !== 'mcp_access') return null
  const row = await findAccessToken(String(claims.jti ?? ''))
  if (!row) return null
  return { userId: row.user_id, email: String(claims.email ?? ''), clientId: row.client_id ?? '' }
}
