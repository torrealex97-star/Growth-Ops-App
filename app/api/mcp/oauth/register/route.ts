import { NextRequest, NextResponse } from 'next/server'
import { hashToken, randomToken } from '@/lib/mcp/crypto'
import { insertClient } from '@/lib/mcp/store'

/**
 * Registro dinámico de clientes (RFC 7591). ChatGPT y Claude obtienen aquí su client_id al
 * conectar. Sin autenticación previa: el redirect_uri se valida EXACTO contra la lista
 * registrada en cada authorize/token — el registro solo decide qué dominios pueden pedir
 * consentimiento al usuario en la pantalla de la app.
 *
 * Coste de abuso bajo: cada registro crea una fila que no puede usarse si el usuario nunca
 * aprueba el consentimiento; el secret se devuelve UNA vez.
 */
const SCHEME_OK = /^https:\/\/[^\s/$.?#].[^\s]*$/i

export async function POST(request: NextRequest) {
  let body: { client_name?: unknown; redirect_uris?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const name =
    typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 100)
      : 'Cliente MCP'
  const uris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === 'string')
    : []
  if (uris.length === 0 || uris.length > 10) {
    return NextResponse.json({ error: 'redirect_uris debe contener entre 1 y 10 URLs https' }, { status: 400 })
  }
  for (const uri of uris) {
    if (!SCHEME_OK.test(uri)) {
      return NextResponse.json({ error: `redirect_uri inválida (solo https): ${uri.slice(0, 100)}` }, { status: 400 })
    }
  }
  const clientId = `mcp_${randomToken(16)}`
  const clientSecret = randomToken(32)
  // owner_user_id queda nulo: se fija cuando un usuario con sesión aprueba el consentimiento.
  // Un cliente sin dueño jamás recibe códigos ni tokens (authorize lo exige).
  await insertClient({
    client_id: clientId,
    client_secret_hash: hashToken(clientSecret),
    name,
    owner_user_id: null,
    redirect_uris: uris,
  })
  return NextResponse.json(
    {
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    { status: 201 }
  )
}
