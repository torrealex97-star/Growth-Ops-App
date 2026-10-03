import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// -----------------------------------------------------------------------------
// HALLAZGOS ABIERTOS DE LA AUDITORÍA FASE A (efectos externos, 28-sep):
// 1. El backfill de YouTube publicaba el vídeo ANTES de actualizar el estado (y
//    ignoraba el resultado del UPDATE): un fallo dejaba la fila 'pending' y la
//    siguiente pasada volvía a publicar (duplicado público + cuota). Sin claim:
//    dos ejecuciones solapadas podían subir el mismo reel.
// 2. El cron de Reels declaraba maxDuration=60 pero un TIME_BUDGET de 270 s
//    (comentario "sobre maxDuration=300"): el runtime cortaba a mitad de una
//    generación y ni los esqueletos llegaban a persistirse.
// -----------------------------------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(aqui, '..', p), 'utf8')

test('backfill YouTube: claim atómico pending→uploading ANTES de publicar', () => {
  const src = read('lib/youtube/backfill.ts')
  const idxClaim = src.indexOf("status: 'uploading'")
  const idxUpload = src.indexOf('await uploadReelToYoutube')
  assert.ok(idxClaim > -1 && idxUpload > idxClaim, 'el claim precede al upload (efecto externo irreversible)')
  // El claim es CAS: solo toma la fila si sigue 'pending' (idempotencia + sin solapes).
  const claim = src.slice(idxClaim, idxUpload)
  assert.ok(claim.includes(".eq('status', 'pending')"), 'el update de claim condiciona por status pending')
  assert.ok(
    claim.includes('if (claimado.error || !claimado.data?.length) return false'),
    'si el claim falla, la fila queda pendiente para otra pasada (no se sube)'
  )
})

test('backfill YouTube: el espejo post-upload nunca provoca otra subida', () => {
  const src = read('lib/youtube/backfill.ts')
  // El update a 'uploaded' verifica su error (reconciliación manual, NO re-selección).
  assert.ok(src.includes('const { error: markUploadedErr } = await sb'), 'el update post-upload captura su error')
  assert.ok(src.includes('DUPLICADO'), 'el fallo del espejo queda registrado y auditado')
  // El catch marca 'failed' comprobando también su resultado (ya no es fire-and-forget).
  assert.ok(src.includes("no se pudo marcar 'failed'"), 'el update de failed también verifica su error')
})

test('cron Reels: presupuesto dentro del runtime de Vercel', () => {
  const src = read('app/api/[tenant]/evergreen/cron/reels/route.ts')
  const maxDuration = Number(src.match(/export const maxDuration = (\d+)/)?.[1])
  const budget = Number(src.match(/TIME_BUDGET_MS = ([\d_]+)/)?.[1]?.replace(/_/g, ''))
  assert.equal(maxDuration, 60)
  // El presupuesto debe dejar margen para cold start/middleware y terminar ANTES del corte:
  // así el bucle decide él mismo cuándo parar y llega a persistir lo hecho.
  assert.ok(budget < maxDuration * 1000, 'el presupuesto de 270s era inalcanzable: debe ser < maxDuration')
  assert.ok(budget <= (maxDuration - 10) * 1000, 'margen de al menos 10s para cold start y cierre')
})

test('cron Reels: esqueletos persistidos ANTES del bucle (nada se pierde si corta)', () => {
  const src = read('app/api/[tenant]/evergreen/cron/reels/route.ts')
  const idxSkeleton = src.indexOf('Esqueleto INMEDIATO')
  const idxLoop = src.indexOf('for (const candidate of candidates')
  assert.ok(idxSkeleton > -1 && idxSkeleton < idxLoop, 'los esqueletos se registran antes de generar nada')
  // La rama de presupuesto agotado ya no hace upsert (quedó huérfano tras la migración):
  // solo salta, porque el esqueleto ya existe.
  const ramaSkip = src.slice(
    src.indexOf('Presupuesto agotado'),
    src.indexOf('const result = await generateDraftForMedia')
  )
  assert.ok(!ramaSkip.includes("from('reel_drafts')"), 'la rama de presupuesto agotado no reescribe esqueletos')
})
