import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import {
  BUNNY_TUS_ENDPOINT,
  FIRMA_VALIDEZ_S,
  configBunny,
  crearVideoBunny,
  faltaEnConfigBunny,
  firmaSubidaBunny,
  urlsVideoBunny,
} from '@/lib/vsl/bunny'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Prepara la subida de un VSL a Bunny Stream: crea el vídeo y devuelve una firma de un solo uso para
// que el navegador suba el fichero DIRECTO a Bunny. La API key nunca sale de aquí (ver lib/vsl/bunny.ts).
//
// GET  → ¿está Bunny configurado en esta subcuenta? (la pantalla decide qué vía de subida usar)
// POST { titulo } → { videoId, libraryId, firma, expiraEn, tusEndpoint, playlist, miniatura }

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  const cfg = await getTenantConfigWithFallback(auth.tenantId, true)
  const falta = faltaEnConfigBunny(cfg)
  return NextResponse.json({ configurado: falta.length === 0, falta })
}

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const cfg = await getTenantConfigWithFallback(auth.tenantId, true)
  const bunny = configBunny(cfg)
  if (!bunny) {
    // 503 y no 400: no es un fallo de lo que ha enviado el usuario, es que el servicio no está listo.
    const falta = faltaEnConfigBunny(cfg).join(', ')
    return NextResponse.json(
      { error: `Bunny no está configurado: falta ${falta}. Complétalo en Configuración › Integraciones › Bunny.` },
      { status: 503 }
    )
  }

  const body = (await req.json().catch(() => ({}))) as { titulo?: string }
  let creado: Awaited<ReturnType<typeof crearVideoBunny>>
  try {
    creado = await crearVideoBunny(bunny, String(body.titulo ?? '').trim())
  } catch {
    return NextResponse.json({ error: 'Bunny no responde. Inténtalo de nuevo en un momento.' }, { status: 502 })
  }
  if ('error' in creado) return NextResponse.json({ error: creado.error }, { status: 502 })

  const expiraEn = Math.floor(Date.now() / 1000) + FIRMA_VALIDEZ_S
  const { playlist, miniatura } = urlsVideoBunny(bunny.cdnHostname, creado.videoId)
  return NextResponse.json({
    videoId: creado.videoId,
    libraryId: bunny.libraryId,
    firma: firmaSubidaBunny(bunny.libraryId, bunny.apiKey, expiraEn, creado.videoId),
    expiraEn,
    tusEndpoint: BUNNY_TUS_ENDPOINT,
    playlist,
    miniatura,
  })
}
