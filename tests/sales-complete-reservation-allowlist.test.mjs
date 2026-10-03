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
// sobre el código fuente; los comentarios se eliminan antes de analizar. Se usan búsquedas de
// cadena (includes/indexOf) en vez de regex con escapes para que el invariante no dependa del
// formateo.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const limpiar = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const RUTA = 'app/api/[tenant]/evergreen/sales/complete-reservation/route.ts'
const src = limpiar(read(RUTA))

test('existe una allowlist explícita de campos y el patch se valida contra ella', () => {
  assert.ok(src.includes('ALLOWED_PATCH_FIELDS = new Set'), 'debe existir la allowlist del patch')
  assert.ok(
    src.includes('Object.keys(patch).filter((k) => !ALLOWED_PATCH_FIELDS.has(k))'),
    'el patch se valida contra la allowlist'
  )
  assert.ok(src.includes('Campos no permitidos en completar reserva'), 'un campo fuera de la lista se rechaza')
  assert.ok(src.includes('status: 400'))
})

test('la allowlist NUNCA incluye tenant_id, id, created_by ni columnas de auditoría/documentos', () => {
  const inicio = src.indexOf('ALLOWED_PATCH_FIELDS')
  const bloque = src.slice(inicio, src.indexOf('])', inicio) + 2)
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
    assert.ok(src.includes("'" + campo + "'"), `falta '${campo}' en la allowlist`)
  }
})

test('la validación del patch va ANTES del update de sales', () => {
  const idxValidacion = src.indexOf('camposNoPermitidos')
  const idxUpdate = src.indexOf("sb.rpc('complete_reservation_with_payment'")
  assert.ok(idxValidacion > -1 && idxValidacion < idxUpdate, 'la allowlist debe filtrar antes de escribir')
})

test('el calendario, el primer cobro y la conversión se ejecutan en la misma transacción', () => {
  const sql = read('supabase/migrations/20261003135010_reservation_stripe_refunds.sql')
  const block = sql.slice(sql.indexOf('create function public.complete_reservation_with_payment'))
  assert.ok(block.includes('delete from public.sale_expected_installments'))
  assert.ok(block.includes('insert into public.sale_expected_installments'))
  assert.ok(block.includes('insert into public.collections'))
  assert.ok(block.includes('p_first_payment<=0'))
  assert.ok(src.includes("sb.rpc('complete_reservation_with_payment'"))
})

test('las filas de cuotas también van por allowlist: sin spread del cuerpo del cliente', () => {
  // El insert regeneraba filas con { ...r, sale_id, tenant_id }: un caller podía inyectar
  // columnas no previstas o estados no válidos (p. ej. is_monitoring=true esconde la cuota del
  // motor de morosidad, flagged_delinquent sale de ahí). Ahora cada campo se copia explícito y
  // un campo fuera de la allowlist responde 400 antes de tocar la base.
  assert.ok(src.includes('ALLOWED_INSTALLMENT_FIELDS = new Set'), 'debe existir la allowlist de cuotas')
  assert.ok(src.includes('Campos no permitidos en las cuotas'), 'un campo de cuota fuera de la lista se rechaza')
  // El spread directo del cuerpo ya no llega al insert: los campos se copian uno a uno.
  // (se comprueba sobre el bloque de filas ya limpio de comentarios: un literal de búsqueda
  // con // dentro sería destruido por limpiar() y la aserción pasaría vacía)
  // sale_id/tenant_id se sellan por servidor, nunca salen del cuerpo.
  const idxFilas = src.indexOf('const rows =')
  const idxInsert = src.indexOf("sb.rpc('complete_reservation_with_payment'")
  assert.ok(idxFilas > -1 && idxInsert > idxFilas, 'las filas se construyen antes del insert')
  const bloqueFilas = src.slice(idxFilas, idxInsert)
  assert.ok(!bloqueFilas.includes('...'), 'las filas se copian campo a campo, sin spread del cuerpo')
  assert.ok(bloqueFilas.includes('sale_id: saleId'), 'sale_id se sella con el de la URL')
  assert.ok(bloqueFilas.includes('tenant_id: t.tenantId'), 'tenant_id se sella con el de la sesión')
  for (const campo of [
    'sale_id',
    'installment_number',
    'due_date',
    'expected_gross_amount',
    'expected_commissionable_amount',
    'status',
    'is_monitoring',
  ]) {
    assert.ok(src.includes("'" + campo + "'"), `falta '${campo}' en la allowlist de cuotas`)
  }
})
