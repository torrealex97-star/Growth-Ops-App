import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// REGRESIÓN — `sales/complete-reservation` (informe FASE A, 26-sep, hallazgo P1 #1).
//
// Esta ruta va por SERVICE ROLE a propósito (RLS bloqueaba el UPDATE de closer/setter). Sin
// allowlist, `{ ...patch, updated_by: t.userId }` deja que CUALQUIER rol permitido (no solo
// admin/director: también manager/closer/setter/cobros) escriba cualquier columna de `sales`
// — importes, reps, estado, tenant_id — desde un patch arbitrario. Y el borrado del calendario
// de cuotas previo, sin comprobar, podía dejarlo DUPLICADO si fallaba antes del insert.
//
// Estilo de la casa (webhook-ghl.test.mjs, sales-delete-atomico.test.mjs): invariantes estáticos
// sobre el código fuente; los comentarios se eliminan antes de analizar.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const limpiar = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const RUTA = 'app/api/[tenant]/evergreen/sales/complete-reservation/route.ts'
const src = limpiar(read(RUTA))

test('existe una allowlist explícita de campos y el patch se valida contra ella', () => {
  assert.match(src, /ALLOWED_PATCH_FIELDS\s*=\s*new Set/)
  assert.match(src, /Object\.keys\(patch\)\.filter\(\(k\)\s*=>\s*!ALLOWED_PATCH_FIELDS\.has\(k\)\)/)
  assert.ok(src.includes('Campos no permitidos en completar reserva'), 'un campo fuera de la lista se rechaza')
  assert.match(src, /status:\s*400/)
})

test('la allowlist NUNCA incluye tenant_id, id, created_by ni columnas de auditoría/documentos', () => {
  const bloque = src.slice(src.indexOf('ALLOWED_PATCH_FIELDS'), src.indexOf('])') + 2)
  for (const prohibido of [
    "'tenant_id'",
    "'id'",
    "'created_by'",
    "'updated_by'",
    "'documents_verified'",
    "'course_access_granted_at'",
  ]) {
    assert.ok(!bloque.includes(prohibido), `${prohibido} no debería poder llegar por patch`)
  }
})

test('la allowlist cubre exactamente los campos que envía la UI (registro/nueva)', () => {
  // updatePayload + teamFields + buyerFields de app/[tenant]/ventas/registro/nueva/page.tsx —
  // si la UI empieza a mandar un campo nuevo, este test avisa de que hay que añadirlo aquí.
  const esperados = [
    'appointment_id',
    'product_id',
    'payment_plan_id',
    'sale_date',
    'refund_deadline_at',
    'gross_amount',
    'expected_commissionable_amount',
    'reservation_amount',
    'down_payment_amount',
    'installments_count',
    'installments_start_date',
    'reservation_completed_at',
    'payment_method',
    'custom_plan',
    'payment_proof_path',
    'setter_id',
    'closer_id',
    'affiliate_id',
    'affiliate_commission_percent',
    'buyer_is_scheduler',
    'payer_data',
    'access_email',
    'status',
    'notes',
  ]
  for (const campo of esperados) {
    assert.ok(src.includes(`'${campo}'`), `falta '${campo}' en la allowlist`)
  }
})

test('la validación del patch va ANTES del update de sales', () => {
  const idxValidacion = src.indexOf('camposNoPermitidos')
  const idxUpdate = src.indexOf(".from('sales').update(payload)")
  assert.ok(idxValidacion > -1 && idxValidacion < idxUpdate, 'la allowlist debe filtrar antes de escribir')
})

test('el borrado del calendario de cuotas previo se comprueba antes de insertar el nuevo', () => {
  // Antes: `await sb.from('sale_expected_installments').delete()...` sin capturar error, seguido
  // directo del insert — si el delete fallaba, el insert añadía cuotas ENCIMA de las viejas.
  assert.match(
    src,
    /const\s*\{\s*error:\s*delInstErr\s*\}\s*=\s*await sb\.from\('sale_expected_installments'\)\.delete\(\)/
  )
  const idxCheck = src.indexOf('if (delInstErr)')
  const idxInsert = src.indexOf(".from('sale_expected_installments').insert(rows)")
  assert.ok(idxCheck > -1 && idxCheck < idxInsert, 'el error del borrado se comprueba antes del insert')
  assert.ok(src.includes('No se pudo limpiar el calendario de cuotas anterior'))
})
