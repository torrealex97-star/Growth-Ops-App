// V0 — PRESERVATION GATE del módulo VSL (auditoría 22-sep, docs/VSL_MODULE_AUDIT.md).
// Fija el comportamiento ACTUAL del núcleo antes de extender nada (V1+): si algo de esto
// falla tras un cambio futuro, el cambio NO se fusiona (OLD BEHAVIOR = PASS).
// Patrón del repo: la lógica pura se replica congelada; las rutas se verifican por fuente.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const lee = (p) => readFileSync(join(root, p), 'utf8')

// ---------------------------------------------------------------------------
// 1. TRACK: dedupe de watched_seconds y saneamiento del latido (heatmap real)
// ---------------------------------------------------------------------------
test('track: fusiona segundos vistos sin duplicados, acotados y saneados', () => {
  const route = lee('app/api/vsl/track/route.ts')
  // El latido dedupea en DB con array_agg(DISTINCT) — heatmap real que tolera rebobinados.
  assert.match(route, /array_agg\(DISTINCT e ORDER BY e\)/, 'watched_seconds se fusiona sin duplicados')
  // Saneamiento antes de tocar DB: enteros >= 0, < 1 día, sin NaN.
  assert.match(route, /Number\.isFinite\(s\)/, 'descarta basura numérica')
  assert.match(route, /s >= 0 && s < 86_400/, 'acota los segundos a un rango razonable')
  // max_position y duration solo suben (GREATEST): la retención nunca retrocede.
  assert.match(route, /GREATEST\(max_position/, 'max_position monótona creciente')
  assert.match(route, /GREATEST\(duration/, 'duration monótona creciente')
  // reached_end acumulativo y first_play_at inmutable tras la primera vez.
  assert.match(route, /reached_end\s*= reached_end OR/, 'reached_end se pega una vez vista')
  assert.match(route, /COALESCE\(first_play_at/, 'first_play_at se fija solo la primera vez')
  // Exige sessionId: sin él no hay fila que tocar.
  assert.match(route, /sessionId requerido/, 'rechaza latidos sin sesión')
})

test('track: el evento ended/unload viaja por sendBeacon (sobrevive al cierre del tab)', () => {
  const player = lee('components/vsl/VslPlayer.tsx')
  assert.match(player, /sendBeacon/, 'el player usa sendBeacon para ended/unload')
  assert.match(player, /'application\/json'/, 'el beacon viaja como JSON')
})

// ---------------------------------------------------------------------------
// 2. IDENTIFY: validación que nunca rompe el tracking de la landing
// ---------------------------------------------------------------------------
test('identify: descarta merge fields sin resolver y emails inválidos, sin lanzar', () => {
  const route = lee('app/api/vsl/identify/route.ts')
  assert.match(route, /\{\{/, 'detecta merge fields de GHL sin resolver')
  assert.match(route, /\[\^\\s@\]\+@/, 'valida la pinta del email')
  assert.match(route, /COALESCE\(\$\{cleanEmail\}, lead_email\)/, 'email nulo NO borra el existente')
  assert.match(route, /COALESCE\(\$\{cleanName\}, lead_name\)/, 'name nulo NO borra el existente')
  assert.match(route, /sessionId requerido/, 'rechaza identify sin sesión')
})

// ---------------------------------------------------------------------------
// 3. SESSION: upsert por (video_id, anon_id) con dispositivo y país
// ---------------------------------------------------------------------------
test('session: una sesión por vídeo+anon, con device/country/UA capturados', () => {
  const route = lee('app/api/vsl/session/route.ts')
  assert.match(route, /ON CONFLICT \(video_id, anon_id\)/, 'sesión única por vídeo+anon (comportamiento actual)')
  assert.match(route, /DO UPDATE SET updated_at = now\(\)/, 'el retorno refresca la sesión existente')
  assert.match(route, /referrer = COALESCE\(vsl_sessions\.referrer, EXCLUDED\.referrer\)/, 'el primer referrer gana')
  assert.match(route, /x-vercel-ip-country|cf-ipcountry/, 'país desde headers de edge')
  assert.match(route, /slug y anonId requeridos/, 'valida entrada mínima')
})

// ---------------------------------------------------------------------------
// 4. TENANT ISOLATION: toda query tenant-side lleva filtro explícito
// ---------------------------------------------------------------------------
test('tenant scoping: videos y metrics filtran tenant_id en TODAS sus consultas', () => {
  const videos = lee('app/api/[tenant]/evergreen/vsl/videos/route.ts')
  assert.match(videos, /WHERE tenant_id = \$\{auth\.tenantId\}/, 'listado filtrado por tenant')
  assert.match(videos, /AND tenant_id = \$\{auth\.tenantId\}/, 'update/delete filtrados por tenant')
  assert.match(videos, /WHERE slug = \$\{slug\} AND tenant_id/, 'chequeo de slug dentro del tenant')
  const metrics = lee('app/api/[tenant]/evergreen/vsl/metrics/[slug]/route.ts')
  assert.match(metrics, /requireTenant/, 'metrics exige sesión de subcuenta')
  // La consulta de sesión de métricas une con el vídeo del tenant (no confía en el slug solo).
  assert.match(metrics, /tenant_id = \$\{tenantId\}/, 'métricas acotadas al tenant')
})

test('secrets: la API key de Bunny jamás sale del servidor', () => {
  const bunny = lee('app/api/[tenant]/evergreen/vsl/bunny/route.ts')
  // La ruta devuelve la FIRMA efímera (necesaria para TUS), nunca un campo apiKey como valor.
  assert.ok(!/apiKey\s*:/.test(bunny), 'ninguna respuesta devuelve la apiKey como campo')
  const firma = lee('lib/vsl/bunny.ts')
  assert.match(firma, /createHash\('sha256'\)/, 'firma TUS SHA256 (contrato Bunny)')
  assert.match(firma, /FIRMA_VALIDEZ_S = 6 \* 60 \* 60/, 'la firma caduca (6h)')
})

// ---------------------------------------------------------------------------
// 5. SYNC CRM: el % visto al contacto solo sube y jamás tumba el tracking
// ---------------------------------------------------------------------------
test('sync: vsl_watch_pct monótono y fallos aislados (columnas ausentes no rompen)', () => {
  const sync = lee('lib/vsl/sync.ts')
  assert.match(sync, /GREATEST\(COALESCE\(vsl_watch_pct, 0\), \$\{pct\}\)/, 'el % solo sube')
  assert.match(sync, /Math\.min\(100,/, 'acotado a 100')
  assert.match(sync, /catch \{/, 'un fallo de sync no rompe el tracking')
})

// ---------------------------------------------------------------------------
// 6. EMBED: el embed público sigue sirviendo el vídeo sin auth
// ---------------------------------------------------------------------------
test('embed: sigue siendo público por slug y con 404 amigable', () => {
  const embed = lee('app/embed/vsl/[slug]/page.tsx')
  assert.match(embed, /FROM vsl_videos WHERE slug = \$\{slug\}/, 'lookup por slug (sin tenant: embed público)')
  assert.match(embed, /Vídeo no encontrado/, '404 amigable')
  assert.match(embed, /preconnect/, 'preconnect del CDN intacto')
})

// ---------------------------------------------------------------------------
// 8. V1 — soft delete + rate limit (extensión segura sobre lo preservado)
// ---------------------------------------------------------------------------
test('V1: los vídeos se borran en soft (deleted_at) y todo lookup respeta los borrados', () => {
  const videos = lee('app/api/[tenant]/evergreen/vsl/videos/route.ts')
  assert.match(videos, /SET deleted_at = now\(\)/, 'DELETE lógico, no físico')
  assert.match(videos, /deleted_at IS NULL/, 'el listado excluye borrados')
  const embed = lee('app/embed/vsl/[slug]/page.tsx')
  assert.match(embed, /deleted_at IS NULL/, 'el embed no sirve vídeos borrados')
  const session = lee('app/api/vsl/session/route.ts')
  assert.match(session, /deleted_at IS NULL/, 'las sesiones solo nacen para vídeos vivos')
})

test('V1: session y track llevan rate limit ( MinuteRateLimiter del pixel)', () => {
  const session = lee('app/api/vsl/session/route.ts')
  assert.match(session, /MinuteRateLimiter/, 'limitador reutilizado, no reinventado')
  assert.match(session, /429/, 'rechazo con 429')
  const track = lee('app/api/vsl/track/route.ts')
  assert.match(track, /limiter\.allow/, 'track también acotado')
})

// ---------------------------------------------------------------------------
// 7. CONFIG: mergeConfig rellena defaults — las claves nuevas no rompen vídeos viejos
// ---------------------------------------------------------------------------
test('config: mergeConfig completa los defaults de vídeos con config parcial/vieja', () => {
  const types = lee('lib/vsl/types.ts')
  assert.match(types, /export const DEFAULT_CONFIG/, 'existe DEFAULT_CONFIG')
  assert.match(types, /mergeConfig/, 'existe mergeConfig')
  // Defaults del contrato actual del player.
  for (const clave of ['autoplay', 'muted', 'lockSeek', 'fakeProgress', 'loop', 'exitHook']) {
    assert.match(types, new RegExp(clave + ':'), `default ${clave} presente`)
  }
})
