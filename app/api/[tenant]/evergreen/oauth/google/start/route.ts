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
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
  }

  const provider = new URL(req.url).searchParams.get('provider')
  if (provider !== 'ga4' && provider !== 'gmail') {
    return NextResponse.json({ error: "El proveedor debe ser 'ga4' o 'gmail'" }, { status: 400 })
  }

  const creds = await googleCredentials(session.tenantId)
  if (!creds) {
    return NextResponse.json(
      {
        error:
          'Faltan el Client ID y el Client Secret de Google. Configúralos en Integraciones → Google (GA4 y Gmail).',
      },
      { status: 400 }
    )
  }

  try {
    const state = signState({ tenant, provider })
    return NextResponse.redirect(authorizationUrl({ clientId: creds.clientId, scopes: SCOPES[provider], state }))
  } catch (e) {
    // Sin CONFIG_ENC_KEY no se puede firmar el state, y un state sin firma sería precisamente el
    // agujero que permite reclamar otra subcuenta. Antes falla que seguir sin firma.
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo iniciar el flujo' }, { status: 500 })
  }
}
