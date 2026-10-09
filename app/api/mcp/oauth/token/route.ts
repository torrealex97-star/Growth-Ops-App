import { NextRequest, NextResponse } from 'next/server'
import { canjearCodigo, refrescarToken } from '@/lib/mcp/oauth'

/**
 * Token endpoint OAuth 2.1. Solo authorization_code (con PKCE) y refresh_token con rotación.
 * Errores con el formato estándar { error, error_description } y Cache-Control: no-store.
 */
export async function POST(request: NextRequest) {
  const noStore = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' }
  let body: Record<string, unknown>
  const contentType = request.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      body = (await request.json()) as Record<string, unknown>
    } else {
      const form = await request.formData()
      body = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, unknown>
    }
  } catch {
    return NextResponse.json({ error: 'invalid_request', error_description: 'Cuerpo inválido' }, { status: 400, headers: noStore })
  }

  const grant = typeof body.grant_type === 'string' ? body.grant_type : ''
  const result = grant === 'authorization_code' ? await canjearCodigo(body) : grant === 'refresh_token' ? await refrescarToken(body) : { ok: false as const, error: 'grant_type no soportado (solo authorization_code y refresh_token)', status: 400 }

  if (!result.ok) {
    const status = result.status
    const code = status === 401 ? 'invalid_client' : status === 503 ? 'server_error' : 'invalid_grant'
    return NextResponse.json({ error: code, error_description: result.error }, { status, headers: noStore })
  }
  const { ok: _ok, ...tokens } = result
  return NextResponse.json(tokens, { headers: noStore })
}
