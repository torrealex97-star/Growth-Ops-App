import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Proxy de Google Fonts: devuelve el CSS con @font-face (woff2) para poder
// embeber las fuentes en el PNG exportado (html-to-image fontEmbedCSS).
export async function GET(req: NextRequest, { params: routeParams }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await routeParams
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const families = new URL(req.url).searchParams.get('families') || ''
  if (!families.trim()) return new NextResponse('', { headers: { 'Content-Type': 'text/css' } })

  const params = families
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => `family=${encodeURIComponent(f)}:wght@300;400;500;600;700;800;900`)
    .join('&')

  const url = `https://fonts.googleapis.com/css2?${params}&display=swap`
  try {
    const res = await fetch(url, {
      headers: {
        // UA moderno para que Google sirva woff2
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      },
    })
    const css = await res.text()
    return new NextResponse(css, {
      headers: {
        'Content-Type': 'text/css',
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',
      },
    })
  } catch {
    return new NextResponse('', { headers: { 'Content-Type': 'text/css' } })
  }
}
