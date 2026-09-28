import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// VENTAS BORRADOR — invariantes estáticos de la integración (webhook + rutas de aprobación/rechazo +
// mapeo de Price ID). Complementa tests/stripe-sale-drafts.test.mjs (lógica pura de sugerencia).

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8').replace(/\/\/[^\n]*/g, '')

test('el webhook nunca escribe sales/collections directamente: solo sugiere en sale_drafts', () => {
  const src = leer('app/api/[tenant]/evergreen/webhooks/stripe/route.ts')
  assert.ok(!/from\('sales'\)\.(insert|update|upsert)/.test(src), 'el webhook no debe crear ni tocar sales')
  assert.ok(!/from\('collections'\)\.(insert|update|upsert)/.test(src), 'el webhook no debe crear ni tocar collections')
  assert.match(src, /from\('sale_drafts'\)\.insert/)
})

test('crear el borrador es best-effort: un fallo no puede tumbar la respuesta 200 del webhook', () => {
  const src = leer('app/api/[tenant]/evergreen/webhooks/stripe/route.ts')
  const idxFn = src.indexOf('async function intentarCrearBorrador')
  const cuerpo = src.slice(idxFn, src.indexOf('\n}\n', idxFn))
  assert.match(cuerpo, /try \{/)
  assert.match(cuerpo, /catch \(e\) \{/)
})

test('el borrador es idempotente: 23505 (mismo pago dos veces) no se trata como error', () => {
  const src = leer('app/api/[tenant]/evergreen/webhooks/stripe/route.ts')
  assert.match(src, /insErr\.code !== '23505'/)
})

test('aprobar un borrador exige venta existente O producto+plan, nunca ninguno', () => {
  const src = leer('app/api/[tenant]/evergreen/sales/drafts/[id]/approve/route.ts')
  assert.match(src, /Falta elegir producto y plan de pago, o una venta existente/)
})

test('aprobar relee collections antes de escribir: no se confía en lo que trajo el listado', () => {
  const src = leer('app/api/[tenant]/evergreen/sales/drafts/[id]/approve/route.ts')
  const idxRelectura = src.indexOf("from('collections')\n    .select('id')")
  const idxCamino1 = src.indexOf('if (body.saleId) {')
  assert.ok(idxRelectura > -1 && idxRelectura < idxCamino1, 'la comprobación de ya-registrado va antes de escribir')
})

test('aprobar deshace la venta si el cobro no se pudo escribir (no deja una venta huérfana)', () => {
  const src = leer('app/api/[tenant]/evergreen/sales/drafts/[id]/approve/route.ts')
  assert.match(src, /no se pudo deshacer la venta huérfana/)
})

test('rechazar y aprobar solo actúan sobre un borrador en estado pending (transición atómica)', () => {
  for (const ruta of [
    'app/api/[tenant]/evergreen/sales/drafts/[id]/approve/route.ts',
    'app/api/[tenant]/evergreen/sales/drafts/[id]/reject/route.ts',
  ]) {
    const src = leer(ruta)
    assert.match(src, /eq\('status', 'pending'\)/, ruta)
  }
})

test('el mapeo de Price ID valida que el producto y el plan sean de esta subcuenta', () => {
  const src = leer('app/api/[tenant]/evergreen/settings/integraciones/stripe-price-map/route.ts')
  assert.match(src, /Ese producto no es de esta subcuenta/)
  assert.match(src, /Ese plan de pago no es de esta subcuenta/)
})

test('la migración de sale_drafts trae UNIQUE(tenant_id, payment_reference) y RLS de admin/director', () => {
  const src = leer('supabase/migrations/20260928120000_sale_drafts.sql')
  assert.match(src, /UNIQUE \(tenant_id, payment_reference\)/)
  assert.match(src, /is_admin_or_director/)
  assert.match(src, /sale_drafts_tenant_isolation/)
})
