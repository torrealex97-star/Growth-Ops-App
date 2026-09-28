import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// REGRESIÓN — `payments/mark` (informe FASE A, 26-sep, hallazgo P1 #4).
//
// El guard de idempotencia (`.neq('status', 'reversed')`) dejaba pasar un cobro 'disputed' como
// "ya cobrado": la cuota se marcaba `collected` (verde) aunque el dinero está en el aire hasta
// que se resuelva la disputa (docs/MONEY.md D5, igual que lib/canonical/cash.ts: esCobrado =
// status === 'collected'). Estilo de la casa: invariante estático sobre el código fuente.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(root, 'app/api/[tenant]/evergreen/payments/mark/route.ts'), 'utf8').replace(
  /\/\/[^\n]*/g,
  ''
)

test('un cobro disputed NO marca la cuota como collected', () => {
  const idxDisputed = src.indexOf("cobroExistente?.status === 'disputed'")
  const idxMarcaCollected = src.indexOf("status: 'collected', flagged_delinquent: false")
  assert.ok(idxDisputed > -1, 'debe distinguir explícitamente el estado disputed')
  assert.ok(idxDisputed < idxMarcaCollected, 'el chequeo de disputed va antes de marcar collected')
})

test('el guard de disputed devuelve el estado ACTUAL de la cuota, no collected', () => {
  const bloque = src.slice(src.indexOf("cobroExistente?.status === 'disputed'"), src.indexOf('if (inst.status'))
  assert.match(bloque, /status:\s*inst\.status/, 'no debe forzar status: "collected" mientras está en disputa')
})

test('solo se marca collected cuando el cobro existente es exactamente collected', () => {
  assert.match(src, /inst\.status === 'collected' \|\| cobroExistente\?\.status === 'collected'/)
})
