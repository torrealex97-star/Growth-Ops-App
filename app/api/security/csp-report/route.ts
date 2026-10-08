import { NextResponse } from 'next/server'
import { parsearInformesCsp } from '@/lib/security/csp-report'
import { ipDe, limitar } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_REPORT_BYTES = 32 * 1024

export async function POST(request: Request) {
  // Un navegador puede emitir varias violaciones al abrir una sola pantalla. El techo permite
  // observar ese lote sin convertir cada navegación hostil en decenas de invocaciones/logs.
  const limite = limitar(`csp-report:${ipDe(request.headers)}`, 12, 5 * 60_000)
  if (!limite.ok) {
    return NextResponse.json(
      { error: 'Demasiados informes' },
      { status: 429, headers: { 'Retry-After': String(limite.reintentarEnSeg) } }
    )
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REPORT_BYTES) {
    return NextResponse.json({ error: 'Informe demasiado grande' }, { status: 413 })
  }

  const raw = await request.text()
  if (Buffer.byteLength(raw, 'utf8') > MAX_REPORT_BYTES) {
    return NextResponse.json({ error: 'Informe demasiado grande' }, { status: 413 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Informe inválido' }, { status: 400 })
  }

  const violations = parsearInformesCsp(payload)
  if (violations.length === 0) {
    return NextResponse.json({ error: 'Informe CSP sin violaciones válidas' }, { status: 400 })
  }

  // Vercel/Sentry capturan stderr. Solo se registra la forma sanitizada: nunca el cuerpo original,
  // paths, query strings, fragmentos, muestras de script ni cabeceras del navegador.
  console.warn('[csp-report]', { violations })
  return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
