import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { encryptSecret } from '@/lib/config'
import { exchangeCode, fetchGoogleEmail, googleCredentials, SCOPES } from '@/lib/google/oauth'
import { verifyState } from '@/lib/google/oauth-state'
import { requireTenant } from '@/lib/auth/requireTenant'

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
function backToGoogleSurface(
  tenant: string,
  provider: 'ga4' | 'gmail' | 'calendar' | 'youtube',
  params: Record<string, string>,
  req: NextRequest
): NextResponse {
  // Los closers no tienen acceso al panel administrativo de Integraciones. Calendar vuelve a
  // Agendas, donde vive su configuración personal; GA4/Gmail mantienen su destino histórico.
  const pathname = provider === 'calendar' ? `/${tenant}/crm/agendas` : `/${tenant}/settings/integraciones`
  const url = new URL(pathname, req.nextUrl.origin)
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
    const { tenant, provider, userId } = state.payload

    // El callback conserva las cookies de la sesión que inició OAuth. La firma impide manipular el
    // state y esta comprobación adicional impide que un state capturado dentro de sus 10 minutos se
    // use para conectar una cuenta como si perteneciera a otro closer.
    const session = await requireTenant(tenant)
    if ('error' in session) return session.error
    if (session.userId !== userId) {
      return NextResponse.json({ error: 'La autorización no pertenece a esta sesión.' }, { status: 403 })
    }
    if (provider !== 'calendar' && !session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
      return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
    }

    // Google devuelve `error` si el usuario cancela o deniega. No es un fallo del sistema.
    const denied = sp.get('error')
    if (denied) return backToGoogleSurface(tenant, provider, { google: 'cancelada' }, req)

    const code = sp.get('code')
    if (!code) return backToGoogleSurface(tenant, provider, { google: 'error', motivo: 'sin_codigo' }, req)

    const sb = serviceClient()
    // Solo subcuentas activas conectan integraciones: una archivada/suspendida no puede crear ni
    // renovar tokens (su sesión de usuario ya estaría bloqueada por requireTenant de todos modos).
    const { data: tenantRow } = await sb
      .from('tenants')
      .select('id')
      .eq('slug', tenant)
      .eq('status', 'active')
      .maybeSingle()
    if (!tenantRow) return NextResponse.json({ error: 'Subcuenta desconocida' }, { status: 404 })
    const tenantId = (tenantRow as { id: string }).id

    const creds = await googleCredentials(tenantId, provider)
    if (!creds) return backToGoogleSurface(tenant, provider, { google: 'error', motivo: 'sin_credenciales' }, req)

    const token = await exchangeCode(code, creds)
    if (token.error || !token.refresh_token) {
      // Sin refresh_token la conexión moriría en una hora, así que NO se guarda a medias. El caso
      // típico: Google no lo devuelve si ya se autorizó antes y no se fuerza prompt=consent.
      return backToGoogleSurface(tenant, provider, { google: 'error', motivo: token.error || 'sin_refresh_token' }, req)
    }

    // Los ámbitos que Google concedió DE VERDAD, que pueden ser menos que los pedidos si el usuario
    // desmarcó alguno. Guardar los pedidos haría creer que hay un permiso que no está.
    const granted = (token.scope || '').split(/\s+/).filter(Boolean)
    const faltan = SCOPES[provider].filter((s) => !granted.includes(s))

    const email = token.access_token ? await fetchGoogleEmail(token.access_token) : null

    // YouTube conserva el contrato existente del resto de la app: los jobs leen el refresh token
    // desde integration_settings. El callback reemplaza el antiguo copiar/pegar del Playground.
    if (provider === 'youtube') {
      const { error } = await sb.from('integration_settings').upsert(
        {
          tenant_id: tenantId,
          key: 'YOUTUBE_REFRESH_TOKEN',
          value: encryptSecret(token.refresh_token),
          is_secret: true,
          updated_by: userId,
        },
        { onConflict: 'tenant_id,key' }
      )
      if (error) return backToGoogleSurface(tenant, provider, { google: 'error', motivo: 'no_se_pudo_guardar' }, req)
      return backToGoogleSurface(
        tenant,
        provider,
        faltan.length > 0
          ? { google: 'permisos_incompletos', servicio: provider }
          : { google: 'conectada', servicio: provider },
        req
      )
    }

    const connectionValues = {
      tenant_id: tenantId,
      provider,
      google_email: email,
      // Cifrado, nunca en claro: es una credencial de larga duración.
      refresh_token: encryptSecret(token.refresh_token),
      scopes: granted,
      status: faltan.length > 0 ? 'error' : 'conectada',
      last_error: faltan.length > 0 ? `Faltan permisos concedidos: ${faltan.join(', ')}` : null,
      connected_by: userId,
      ...(provider === 'calendar' ? { owner_user_id: userId } : {}),
    }

    // El índice tenant+provider de GA4/Gmail pasa a ser parcial para permitir N closers Calendar;
    // PostgREST no puede inferir índices parciales en onConflict. Esas dos conexiones se sustituyen
    // explícitamente, mientras Calendar conserva un upsert atómico por tenant+provider+usuario.
    let error: { message: string } | null = null
    if (provider === 'calendar') {
      const saved = await sb
        .from('google_oauth_connections')
        .upsert(connectionValues, { onConflict: 'tenant_id,provider,owner_user_id' })
      error = saved.error
    } else {
      const existing = await sb
        .from('google_oauth_connections')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('provider', provider)
        .maybeSingle()
      if (existing.error) error = existing.error
      else if (existing.data?.id) {
        const saved = await sb.from('google_oauth_connections').update(connectionValues).eq('id', existing.data.id)
        error = saved.error
      } else {
        const saved = await sb.from('google_oauth_connections').insert(connectionValues)
        error = saved.error
      }
    }
    if (error) return backToGoogleSurface(tenant, provider, { google: 'error', motivo: 'no_se_pudo_guardar' }, req)

    return backToGoogleSurface(
      tenant,
      provider,
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
