import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Paths that are always public, outside the /evergreen namespace
const PUBLIC_PATHS = [
  '/firmar',               // página pública de firma de contratos (auth por token)
  '/embed',                // reproductor VSL embebido en landings/GHL (iframe público)
  '/api/vsl',              // tracking del player VSL desde el iframe público (track/identify/session)
]

// Evergreen public routes (login/recover don't require Supabase session)
const EVERGREEN_PUBLIC_PATHS = [
  '/evergreen/login', '/evergreen/recover', '/api/evergreen/auth',
  '/evergreen/afiliados/registro', // formulario público de alta de afiliados
  '/api/evergreen/afiliados/registro', '/api/evergreen/afiliados/form-config', // alta + config del formulario público
  '/api/evergreen/webhooks', // GHL / player VSL — se autentican con su propio secreto, no con sesión
  '/api/evergreen/tracking/events', // ingestión canónica — se autentica con TRACKING_INGEST_KEY
  '/api/evergreen/contracts/sign', // firma pública de contratos — se autentica por token
  '/api/evergreen/admin/setup', // mantenimiento — se autentica con CRON_SECRET
  '/api/evergreen/admin/migrate-meta', // migración v19 Meta — CRON_SECRET o sesión admin
  '/api/evergreen/admin/setup-meta-cron', // programa pg_cron 30 min — CRON_SECRET o sesión admin
  '/api/evergreen/cron', // Vercel Cron — se autentica con CRON_SECRET, no con sesión
  '/api/evergreen/sales/reconcile-all', // reparación masiva — se autentica con CRON_SECRET o sesión admin
]

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.includes('.')) {
    return NextResponse.next()
  }

  // Root redirects to /evergreen/dashboard (see app/page.tsx) — always public
  if (pathname === '/') return NextResponse.next()

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Handle evergreen routes — delegate to Supabase session management
  if (pathname.startsWith('/evergreen') || pathname.startsWith('/api/evergreen')) {
    // Public evergreen paths pass through without session check
    if (EVERGREEN_PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      return NextResponse.next()
    }
    // All other /evergreen/* routes: validate via Supabase updateSession
    return updateSession(request)
  }

  // Anything else falls through to Next.js's own 404 handling
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
