import { NextRequest, NextResponse } from 'next/server'
import { TRACKER_JS, TRACKER_JS_VERSION } from '@/lib/tracking/tracker-js'

// Sirve el SDK del pixel: <script defer src="/tracker.js" data-site="gop_pk_..."></script>.
// Ruta pública a propósito: es un asset estático, no una API. Cache con revalidación corta para
// poder corregir el SDK sin esperar a que expire el cache de los navegadores instalados.
export async function GET(_req: NextRequest) {
  return new NextResponse(TRACKER_JS, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      'X-Gop-Tracker-Version': TRACKER_JS_VERSION,
    },
  })
}
