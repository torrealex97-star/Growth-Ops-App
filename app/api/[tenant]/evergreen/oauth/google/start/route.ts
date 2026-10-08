import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { authorizationUrl, googleCredentials, SCOPES } from '@/lib/google/oauth'
import { signState } from '@/lib/google/oauth-state'

export const runtime = 'nodejs'

// Inicia el flujo OAuth con Google para ESTA subcuenta. La subcuenta sale de la URL y la valida
// requireTenant; nunca del body ni de un parámetro, para que nadie pueda arrancar un flujo en nombre
// de otra. Después viaja firmada en `state`, porque el callback no la lleva en la ruta.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  const provider = new URL(req.url).searchParams.get('provider')
  if (provider !== 'ga4' && provider !== 'gmail' && provider !== 'calendar' && provider !== 'youtube') {
    return NextResponse.json({ error: 'Proveedor de Google no válido' }, { status: 400 })
  }
  // GA4/Gmail son conexiones del tenant y siguen siendo administrativas. Calendar es una conexión
  // personal: cualquier miembro autenticado puede conectar LA SUYA, nunca la de otro usuario.
  if (provider !== 'calendar' && !session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
  }

  const creds = await googleCredentials(session.tenantId, provider)
  if (!creds) {
    return NextResponse.json(
      {
        error:
          provider === 'youtube'
            ? 'Faltan el Client ID y el Client Secret de YouTube. Guárdalos antes de conectar.'
            : 'Faltan el Client ID y el Client Secret de Google. Configúralos en Integraciones → Google.',
      },
      { status: 400 }
    )
  }

  try {
    const state = signState({ tenant, provider, userId: session.userId })
    return NextResponse.redirect(authorizationUrl({ clientId: creds.clientId, scopes: SCOPES[provider], state }))
  } catch (e) {
    // Sin CONFIG_ENC_KEY no se puede firmar el state, y un state sin firma sería precisamente el
    // agujero que permite reclamar otra subcuenta. Antes falla que seguir sin firma.
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo iniciar el flujo' }, { status: 500 })
  }
}
