import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { repNetCash } from '../lib/commissions/generate.ts'

// -----------------------------------------------------------------------------
// HALLAZGOS ABIERTOS DE LA AUDITORÍA FASE A (tanda dinero, 28-sep):
// 1. repNetCash restaba refunds pending/rejected del cash del rep (solo 'processed'
//    es dinero realmente devuelto, igual que el cash canónico).
// 2. El alta de venta ignoraba el resultado de recordCollection: la venta quedaba
//    creada sin collection ni comisiones aparentando éxito.
// 3. collections/record interpretaba un count fallido como "primer cobro" y podía
//    reenviar el evento venta.registrada.
// 4. appointments/create (manual) aceptaba un contactId de OTRA subcuenta.
// -----------------------------------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(aqui, '..', p), 'utf8')

// ── 1. repNetCash: solo refunds 'processed' descuentan ─────────────────────────

/** Mock encadenable de supabase-js que registra las llamadas (para afirmar el filtro). */
function fakeSb(tablas) {
  const llamadas = {}
  const make = (tabla, resultado) => {
    llamadas[tabla] = []
    const chain = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return Promise.resolve(resultado).then.bind(Promise.resolve(resultado))
          return (...args) => {
            llamadas[tabla].push([prop, ...args])
            return chain
          }
        },
      }
    )
    return chain
  }
  const sb = {
    from(tabla) {
      return make(tabla, tablas[tabla])
    },
  }
  return { sb, llamadas }
}

test('repNetCash: pide SOLO refunds processed (pending/rejected no bajan el cash del rep)', async () => {
  const { sb, llamadas } = fakeSb({
    collections: { data: [{ gross_amount: 1000 }], error: null },
    // El servidor devuelve las filas ya filtradas; el mock devuelve todo lo "consultado":
    refunds: { data: [{ gross_refund_amount: 300 }], error: null },
  })
  const cash = await repNetCash(sb, 't1', 'rep1', 'setter')
  assert.equal(cash, 700)
  const opsRefunds = llamadas['refunds'].map((c) => c.join('|'))
  assert.ok(
    opsRefunds.some((c) => c === 'eq|status|processed'),
    'la consulta de refunds debe filtrar .eq("status","processed")'
  )
})

test('repNetCash: sin refunds, el cash collected queda intacto', async () => {
  const { sb } = fakeSb({
    collections: { data: [{ gross_amount: 500 }, { gross_amount: 250 }], error: null },
    refunds: { data: [], error: null },
  })
  assert.equal(await repNetCash(sb, 't1', 'rep1', 'closer'), 750)
})

test('repNetCash: sigue fail-ruidoso si falla la lectura de cobros o devoluciones', async () => {
  const { sb: sbColl } = fakeSb({
    collections: { data: null, error: { message: 'db caída' } },
    refunds: { data: [], error: null },
  })
  await assert.rejects(() => repNetCash(sbColl, 't1', 'rep1', 'setter'), /No se pudo leer el cash collected/)
  const { sb: sbRefs } = fakeSb({
    collections: { data: [{ gross_amount: 10 }], error: null },
    refunds: { data: null, error: { message: 'db caída' } },
  })
  await assert.rejects(() => repNetCash(sbRefs, 't1', 'rep1', 'setter'), /No se pudieron leer las devoluciones/)
})

// ── 2/3/4. Guardas estáticas sobre el fuente ───────────────────────────────────

test('guarda: el alta de venta CONSUME el resultado de recordCollection (nada de fire-and-forget)', () => {
  const src = read('app/[tenant]/ventas/registro/nueva/page.tsx')
  // Cada await de recordCollection debe ir asignado a una variable (el booleano se consume).
  const restantes = src.replace(/=\s*await recordCollection\(/g, '')
  assert.ok(!restantes.includes('await recordCollection('), 'todo recordCollection debe consumir su booleano')
  assert.ok(src.includes('let ventaConCobroFallido = false'), 'bandera de estado parcial declarada')
  // El contrato (acceso al producto) no se genera si el dinero no entró, y el toast no
  // puede anunciar éxito en ese estado.
  const indiceContrato = src.indexOf('contracts/student')
  const indiceGuard = src.indexOf('if (ventaConCobroFallido) {\n      contractSignUrl = null')
  assert.ok(
    indiceGuard > 0 && indiceGuard < indiceContrato,
    'el guard de cobro fallido precede a la creación del contrato'
  )
  assert.ok(
    src.includes("toast.warning(reservationId ? 'Pago completado con cobro incompleto'"),
    'toast honesto ante cobro parcial'
  )
})

test('guarda: collections/record no decide el primer cobro con una lectura corrupta', () => {
  const src = read('app/api/[tenant]/evergreen/collections/record/route.ts')
  assert.ok(src.includes('error: priorErr'), 'el count captura su error')
  assert.ok(
    src.includes('No se pudo comprobar si es el primer cobro de la venta'),
    'fail-ruidoso antes de decidir isFirstCollection'
  )
  const idxGuard = src.indexOf('if (priorErr)')
  const idxDecision = src.indexOf('isFirstCollection = !priorCollections')
  assert.ok(idxGuard > -1 && idxDecision > idxGuard, 'isFirstCollection solo se evalúa tras el guard del error')
})

test('guarda: appointments/create manual valida que el contacto es de la subcuenta', () => {
  const src = read('app/api/[tenant]/evergreen/appointments/create/route.ts')
  const manual = src.slice(src.indexOf('if (body.manual)'), src.indexOf('if (!closerId)'))
  assert.ok(manual.includes(".from('contacts')"), 'consulta el contacto antes de insertar')
  assert.ok(/\.eq\('id', contactId\)[\s\S]*?\.eq\('tenant_id', t\.tenantId\)/.test(manual), 'filtra por id y tenant')
  assert.ok(manual.includes('El contacto no existe en esta subcuenta'), 'rechaza contactos ajenos (no silencioso)')
})
