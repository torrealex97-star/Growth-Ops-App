import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const ADMIN_COOKIE = 'tcc-auth'
const CC_COOKIE = 'tcc-cc-session'

const PUBLIC_PATHS = [
  '/login', '/api/auth',
  '/coldcalling/login', '/api/coldcalling/auth',
  '/lanzamiento',          // hub + all /lanzamiento/* pages
  '/api/lanzamiento',      // all lanzamiento API routes (self-auth)
  '/firmar',               // página pública de firma de contratos (auth por token)
  '/embed',                // reproductor VSL embebido en landings/GHL (iframe público)
  '/api/vsl',              // tracking del player VSL desde el iframe público (track/identify/session)
]
const CC_PATHS = ['/coldcalling', '/api/coldcalling/leads', '/api/coldcalling/update']

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

async function verifyCCSession(token: string): Promise<boolean> {
  try {
    const dot = token.lastIndexOf('.')
    if (dot === -1) return false
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    if (isNaN(parseInt(payload))) return false

    const secret = process.env.CC_SESSION_SECRET || 'cc-secret-fallback-2026'
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    )
    const sigBytes = Uint8Array.from(sig.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))
    return await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload))
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.includes('.')) {
    return NextResponse.next()
  }

  // Hub and landing selection pages are always public
  if (pathname === '/') return NextResponse.next()

  // Handle evergreen routes — delegate to Supabase session management
  if (pathname.startsWith('/evergreen') || pathname.startsWith('/api/evergreen')) {
    // Public evergreen paths pass through without session check
    if (EVERGREEN_PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
      return NextResponse.next()
    }
    // All other /evergreen/* routes: validate via Supabase updateSession
    return updateSession(request)
  }

  // --- Existing non-evergreen logic below ---

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const isAdmin = request.cookies.get(ADMIN_COOKIE)?.value === 'true'
  const ccToken = request.cookies.get(CC_COOKIE)?.value

  if (CC_PATHS.some((p) => pathname.startsWith(p))) {
    if (isAdmin) return NextResponse.next()
    if (ccToken && await verifyCCSession(ccToken)) return NextResponse.next()
    return NextResponse.redirect(new URL('/coldcalling/login', request.url))
  }

  if (isAdmin) return NextResponse.next()

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
