import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// REGRESIÓN — `collections/approve-review` (informe FASE A, 26-sep, hallazgo P1 #2).
//
// El flag `needs_commission_review` se limpiaba ANTES de garantizar que la comisión se generaba:
// si `generateCommissionsForCollection` fallaba después (lanza `Error` en el insert, ver
// lib/commissions/generate.ts), el cobro quedaba "aprobado" en BD sin comisión, y el propio guard
// del endpoint (`if (!coll.needs_commission_review) return 400`) bloqueaba cualquier reintento —
// flujo irrecuperable sin tocar la base a mano. Estilo de la casa: invariante estático.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(root, 'app/api/[tenant]/evergreen/collections/approve-review/route.ts'), 'utf8').replace(
  /\/\/[^\n]*/g,
  ''
)

test('la venta se lee ANTES de aprobar el cobro (nada se muta si esa lectura falla)', () => {
  const idxSaleRead = src.indexOf(".from('sales')")
  const idxUpdate = src.indexOf('.update({ is_eligible_for_commission: true')
  assert.ok(idxSaleRead > -1 && idxUpdate > -1 && idxSaleRead < idxUpdate)
})

test('los errores de la lectura de venta y de la aprobación se comprueban explícitamente', () => {
  assert.match(src, /if \(saleErr \|\| !sale\)/)
  assert.match(src, /if \(updErr \|\| !updated\)/)
})

test('si generar la comisión falla, el cobro vuelve a la cola de revisión (no queda irrecuperable)', () => {
  const idxCatch = src.indexOf('} catch (genErr) {')
  const idxRevert = src.indexOf(
    'update({ is_eligible_for_commission: false, eligible_at: null, needs_commission_review: true })'
  )
  assert.ok(idxCatch > -1 && idxRevert > -1 && idxCatch < idxRevert, 'el catch debe revertir el flag')
})

test('si la reversión también falla, el error lo dice explícitamente (no un ok:true falso)', () => {
  assert.ok(src.includes('El cobro quedó aprobado SIN comisión — revisar a mano'))
})

test('el audit_logs de la aprobación se comprueba: sin rastro no hay ok:true', () => {
  const idxInsert = src.indexOf(".from('audit_logs').insert(")
  const idxCheck = src.indexOf('if (auditErr)')
  const idxOk = src.indexOf('NextResponse.json({ ok: true, commissionsGenerated })')
  assert.ok(idxInsert > -1 && idxCheck > -1 && idxOk > -1 && idxInsert < idxCheck && idxCheck < idxOk)
})
