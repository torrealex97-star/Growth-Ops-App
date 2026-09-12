import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { marketingDestinationFor } from '@/lib/marketing-navigation'

// Paths that are always public, entirely outside the /[tenant] namespace
const PUBLIC_PATHS = [
  '/firmar', // página pública de firma de contratos (auth por token)
  '/embed', // reproductor VSL embebido en landings/GHL (iframe público)
  '/api/vsl', // tracking del player VSL desde el iframe público (track/identify/session)
  // Firma pública de contratos por token — sin tenant en la URL porque las páginas /firmar y
  // /firmar-alumno solo conocen el token; el tenant se resuelve dentro de la propia ruta
  // leyendo el contrato por signing_token (índice UNIQUE global). El token es el mecanismo de
  // seguridad, no la subcuenta.
  '/api/public-contracts',
]

// Sub-rutas públicas DENTRO de un tenant (no requieren sesión Supabase),
// expresadas relativas al tenant — es decir, sin el segmento [tenant].
const TENANT_PUBLIC_SUFFIXES = ['/login', '/recover', '/afiliados/registro']
const TENANT_API_PUBLIC_SUFFIXES = [
  '/evergreen/auth', // login/recover/callback
  '/evergreen/afiliados/registro',
  '/evergreen/afiliados/form-config',
  '/evergreen/webhooks', // GHL / player VSL — se autentican con su propio secreto, no con sesión
  '/evergreen/tracking/events', // ingestión canónica — se autentica con TRACKING_INGEST_KEY
  '/evergreen/admin/setup', // mantenimiento — se autentica con CRON_SECRET
  '/evergreen/admin/migrate-meta', // migración v19 Meta — CRON_SECRET o sesión admin
  '/evergreen/admin/setup-meta-cron', // programa pg_cron 30 min — CRON_SECRET o sesión admin
  '/evergreen/cron', // Vercel Cron — se autentica con CRON_SECRET, no con sesión
  '/evergreen/sales/reconcile-all', // reparación masiva — se autentica con CRON_SECRET o sesión admin
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.includes('.')) {
    return NextResponse.next()
  }

  // Root ('/') is the un-tenanted landing page — always public.
  if (pathname === '/') return NextResponse.next()

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // API routes: /api/<tenant>/evergreen/...
  const apiMatch = pathname.match(/^\/api\/([^/]+)(\/.*)?$/)
  if (apiMatch) {
    const tenant = apiMatch[1]
    const rest = apiMatch[2] || ''
    if (TENANT_API_PUBLIC_SUFFIXES.some((p) => rest.startsWith(p))) {
      return NextResponse.next()
    }
    return updateSession(request, tenant)
  }

  // Pages: /<tenant>/...
  const pageMatch = pathname.match(/^\/([^/]+)(\/.*)?$/)
  if (pageMatch) {
    const tenant = pageMatch[1]
    const rest = pageMatch[2] || '/'
    if (rest === '/settings' && request.nextUrl.searchParams.get('tab') === 'data-health') {
      const destination = request.nextUrl.clone()
      destination.pathname = `/${tenant}/settings/data-health`
      destination.search = ''
      return NextResponse.redirect(destination, 301)
    }
    const legacyDestination = marketingDestinationFor(rest)
    if (legacyDestination) {
      const destination = request.nextUrl.clone()
      const [destinationPath, destinationQuery] = legacyDestination.split('?')
      destination.pathname = `/${tenant}${destinationPath}`
      if (destinationQuery) destination.search = destinationQuery
      return NextResponse.redirect(destination, 301)
    }
    if (TENANT_PUBLIC_SUFFIXES.some((p) => rest.startsWith(p))) {
      return NextResponse.next()
    }
    return updateSession(request, tenant)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
