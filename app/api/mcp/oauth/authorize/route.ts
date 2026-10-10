/**
 * Endpoint de autorización OAuth 2.1 del servidor MCP.
 *
 * GET: valida la petición y muestra la pantalla de consentimiento (requiere sesión Supabase).
 * POST: con la sesión activa y `approve=1`, emite el código y redirige al cliente con él.
 *
 * El consentimiento es la barrera de propiedad: aprobar fija owner_user_id del cliente al
 * usuario con sesión, así un client_id registrado dinámicamente por cualquiera no puede
 * leer datos hasta que TÚ lo apruebas en tu sesión de la app. Es el mismo patrón del resto
 * del repo: la autorización vive en servidor, nunca en lo que manda el cliente.
 */
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { emitirCodigo, validarAutorizacion } from '@/lib/mcp/oauth'

const PAGE_STYLES = `
  body{font-family:system-ui,sans-serif;background:#0b1120;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:32px;max-width:440px}
  h1{font-size:18px;margin:0 0 8px} p{color:#94a3b8;font-size:14px;line-height:1.6}
  code{background:#0b1120;padding:2px 6px;border-radius:4px;font-size:12px;color:#7dd3fc;word-break:break-all}
  form{display:flex;gap:12px;margin-top:24px}
  button{flex:1;padding:10px;border-radius:8px;border:1px solid #334155;cursor:pointer;font-size:14px}
  .si{background:#2563eb;color:white;border-color:#2563eb} .no{background:transparent;color:#94a3b8}
`

async function sesionActual(): Promise<{ userId: string } | null> {
  const cookieStore = await cookies()
  const authed = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll() {},
    },
  })
  const {
    data: { user },
  } = await authed.auth.getUser()
  return user ? { userId: user.id } : null
}

function paginaConsentimiento(opts: { clientName: string; clientId: string; params: URLSearchParams; error?: string }) {
  const { clientName, clientId, params, error } = opts
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Autorizar acceso MCP</title><style>${PAGE_STYLES}</style></head><body><div class="card">
<h1>${error ? 'No se pudo autorizar' : `¿Autorizar acceso a «${clientName}»?`}</h1>
${
  error
    ? `<p>${error}</p>`
    : `<p><strong>${clientName}</strong> (<code>${clientId.slice(0, 24)}…</code>) pide acceso de <strong>solo lectura</strong> a los datos de tus subcuentas: contactos, ventas, cobros, citas, campañas y métricas, exactamente lo que tu usuario ve en la app.</p>
<p>No podrá modificar, borrar ni exportar nada que tu sesión no alcance. Puedes revocar el acceso en cualquier momento desde Configuración.</p>`
}
<form method="POST" action="/api/mcp/oauth/authorize">
${[...params.entries()].map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replace(/"/g, '&quot;')}">`).join('\n')}
${error ? '' : '<button class="si" type="submit" name="approve" value="1">Autorizar</button><button class="no" type="submit" name="approve" value="0">Denegar</button>'}
</form></div></body></html>`
  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const validacion = await validarAutorizacion({
    response_type: p.get('response_type'),
    client_id: p.get('client_id'),
    redirect_uri: p.get('redirect_uri'),
    code_challenge: p.get('code_challenge'),
    code_challenge_method: p.get('code_challenge_method'),
    scope: p.get('scope'),
    state: p.get('state'),
  })
  // Error con redirect_uri verificada: se manda por redirect (estándar). Sin ella, HTML.
  if (validacion.error) {
    if (validacion.redirectUri) {
      const url = new URL(validacion.redirectUri)
      url.searchParams.set('error', 'invalid_request')
      url.searchParams.set('error_description', validacion.error)
      if (validacion.state) url.searchParams.set('state', validacion.state)
      return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } })
    }
    return paginaConsentimiento({
      clientName: 'Cliente MCP',
      clientId: p.get('client_id') ?? '',
      params: p,
      error: validacion.error,
    })
  }

  const sesion = await sesionActual()
  if (!sesion) {
    const login = new URL('/login', request.nextUrl.origin)
    login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(login, { headers: { 'Cache-Control': 'no-store' } })
  }

  return paginaConsentimiento({
    clientName: validacion.clientName ?? 'Cliente MCP',
    clientId: p.get('client_id') ?? '',
    params: p,
  })
}

export async function POST(request: NextRequest) {
  const form = await request.formData()
  const p = new URLSearchParams()
  for (const key of [
    'response_type',
    'client_id',
    'redirect_uri',
    'code_challenge',
    'code_challenge_method',
    'scope',
    'state',
  ]) {
    const v = form.get(key)
    if (typeof v === 'string') p.set(key, v)
  }
  const approve = form.get('approve') === '1'

  const validacion = await validarAutorizacion({
    response_type: p.get('response_type'),
    client_id: p.get('client_id'),
    redirect_uri: p.get('redirect_uri'),
    code_challenge: p.get('code_challenge'),
    code_challenge_method: p.get('code_challenge_method'),
    scope: p.get('scope'),
    state: p.get('state'),
  })
  if (validacion.error || !validacion.redirectUri) {
    return paginaConsentimiento({
      clientName: 'Cliente MCP',
      clientId: p.get('client_id') ?? '',
      params: p,
      error: validacion.error ?? 'Petición inválida',
    })
  }

  const url = new URL(validacion.redirectUri)
  if (validacion.state) url.searchParams.set('state', validacion.state)

  if (!approve) {
    url.searchParams.set('error', 'access_denied')
    url.searchParams.set('error_description', 'El usuario denegó el acceso')
    return NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store' } })
  }

  const sesion = await sesionActual()
  if (!sesion)
    return NextResponse.redirect(new URL('/login', request.nextUrl.origin), {
      headers: { 'Cache-Control': 'no-store' },
    })

  const code = await emitirCodigo({
    clientId: p.get('client_id')!,
    userId: sesion.userId,
    redirectUri: validacion.redirectUri,
    scope: p.get('scope') || 'read',
    codeChallenge: p.get('code_challenge')!,
  })
  // La propiedad del cliente se fija en el primer consentimiento: de aquí en adelante solo
  // este usuario ve y puede revocar este cliente.
  const { asignarPropietario } = await import('@/lib/mcp/store')
  await asignarPropietario(p.get('client_id')!, sesion.userId)

  url.searchParams.set('code', code)
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store' } })
}
