import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// REGRESIÓN — `collections/[id]` PATCH (informe FASE A, 26-sep, hallazgo P1 #3).
//
// `syncInstallmentStatus` (vuelve la cuota a 'pending' si se queda sin cobros vivos, o la deja
// 'collected' si sigue teniendo uno) solo se llamaba desde DELETE. Revertir el ÚNICO cobro de una
// cuota vía PATCH (status: 'reversed'/'disputed') dejaba `sale_expected_installments.status` en
// 'collected' para siempre — payments/mark la veía "ya cobrada" y bloqueaba volver a cobrarla.
// Estilo de la casa: invariante estático sobre el código fuente.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(root, 'app/api/[tenant]/evergreen/collections/[id]/route.ts'), 'utf8').replace(
  /\/\/[^\n]*/g,
  ''
)

test('el PATCH lee expected_installment_id del cobro', () => {
  const idxSelect = src.indexOf(".from('collections')")
  const idxPatchFn = src.indexOf('export async function PATCH')
  const idxDeleteFn = src.indexOf('export async function DELETE')
  const bloquePatch = src.slice(idxPatchFn, idxDeleteFn)
  assert.match(bloquePatch, /select\(\s*\n?\s*'id, sale_id, expected_installment_id/)
  assert.ok(idxSelect > -1)
})

test('el PATCH llama a syncInstallmentStatus tras actualizar el cobro, no solo el DELETE', () => {
  const idxPatchFn = src.indexOf('export async function PATCH')
  const idxDeleteFn = src.indexOf('export async function DELETE')
  const bloquePatch = src.slice(idxPatchFn, idxDeleteFn)
  const bloqueDelete = src.slice(idxDeleteFn)
  assert.ok(bloquePatch.includes('syncInstallmentStatus(sb, coll.expected_installment_id)'), 'falta en PATCH')
  assert.ok(bloqueDelete.includes('syncInstallmentStatus(sb, coll.expected_installment_id)'), 'sigue en DELETE')
})

test('la sincronización va DESPUÉS de escribir el nuevo status del cobro (reversed/disputed incluidos)', () => {
  const idxUpdate = src.indexOf(".from('collections').update(update)")
  const idxSync = src.indexOf('await syncInstallmentStatus(sb, coll.expected_installment_id)')
  assert.ok(idxUpdate > -1 && idxSync > -1 && idxUpdate < idxSync)
})
