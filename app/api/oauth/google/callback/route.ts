import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { encryptSecret } from '@/lib/config'
import { exchangeCode, fetchGoogleEmail, googleCredentials, SCOPES } from '@/lib/google/oauth'
import { verifyState } from '@/lib/google/oauth-state'

export const runtime = 'nodejs'

// Callback de Google. Vive FUERA del espacio /api/[tenant]/ porque el URI de redirección registrado
// en Google Cloud es exactamente /api/oauth/google/callback, sin subcuenta: Google compara la cadena
// y exige registrar cada URI una a una, así que un callback por subcuenta obligaría a editar la
// consola cada vez que se crea una.
//
// Consecuencia: la subcuenta llega en `state`, y `state` va FIRMADO. Sin firma, cualquiera podría
// llamar aquí con su propio código y `state` apuntando a otra subcuenta, y el refresh token de su
// cuenta de Google quedaría guardado como la conexión de esa subcuenta ajena.

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Se devuelve al usuario a la pantalla de Integraciones de SU subcuenta con el resultado en la URL,
// en vez de dejarle ante un JSON: viene de una pantalla y tiene que volver a una pantalla.
function backToIntegrations(tenant: string, params: Record<string, string>, req: NextRequest): NextResponse {
  const url = new URL(`/${tenant}/settings/integraciones`, req.nextUrl.origin)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const state = verifyState(sp.get('state'))
    if (!state.ok) {
      // Sin un state válido no se sabe a qué subcuenta volver, así que no hay redirección posible.
      // Y no se dice más de lo necesario: el motivo exacto solo ayudaría a quien esté probando.
      return NextResponse.json(
        { error: 'La autorización no es válida o ha caducado. Vuelve a intentarlo.' },
        { status: 400 }
      )
    }
    const { tenant, provider } = state.payload

    // Google devuelve `error` si el usuario cancela o deniega. No es un fallo del sistema.
    const denied = sp.get('error')
    if (denied) return backToIntegrations(tenant, { google: 'cancelada' }, req)

    const code = sp.get('code')
    if (!code) return backToIntegrations(tenant, { google: 'error', motivo: 'sin_codigo' }, req)

    const sb = serviceClient()
    const { data: tenantRow } = await sb.from('tenants').select('id').eq('slug', tenant).maybeSingle()
    if (!tenantRow) return NextResponse.json({ error: 'Subcuenta desconocida' }, { status: 404 })
    const tenantId = (tenantRow as { id: string }).id

    const creds = await googleCredentials(tenantId)
    if (!creds) return backToIntegrations(tenant, { google: 'error', motivo: 'sin_credenciales' }, req)

    const token = await exchangeCode(code, creds)
    if (token.error || !token.refresh_token) {
      // Sin refresh_token la conexión moriría en una hora, así que NO se guarda a medias. El caso
      // típico: Google no lo devuelve si ya se autorizó antes y no se fuerza prompt=consent.
      return backToIntegrations(tenant, { google: 'error', motivo: token.error || 'sin_refresh_token' }, req)
    }

    // Los ámbitos que Google concedió DE VERDAD, que pueden ser menos que los pedidos si el usuario
    // desmarcó alguno. Guardar los pedidos haría creer que hay un permiso que no está.
    const granted = (token.scope || '').split(/\s+/).filter(Boolean)
    const faltan = SCOPES[provider].filter((s) => !granted.includes(s))

    const email = token.access_token ? await fetchGoogleEmail(token.access_token) : null

    const { error } = await sb.from('google_oauth_connections').upsert(
      {
        tenant_id: tenantId,
        provider,
        google_email: email,
        // Cifrado, nunca en claro: es una credencial de larga duración.
        refresh_token: encryptSecret(token.refresh_token),
        scopes: granted,
        status: faltan.length > 0 ? 'error' : 'conectada',
        last_error: faltan.length > 0 ? `Faltan permisos concedidos: ${faltan.join(', ')}` : null,
      },
      { onConflict: 'tenant_id,provider' }
    )
    if (error) return backToIntegrations(tenant, { google: 'error', motivo: 'no_se_pudo_guardar' }, req)

    return backToIntegrations(
      tenant,
      faltan.length > 0
        ? { google: 'permisos_incompletos', servicio: provider }
        : { google: 'conectada', servicio: provider },
      req
    )
  } catch (err) {
    console.error('[api/app/api/oauth/google/callback GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
