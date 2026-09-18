import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resumenCross, runCrossChecks, STALE_POR_DEFECTO_MS } from '../../lib/data-health/cross-source.ts'

// GOLDEN DATASET (§53): un universo pequeño, determinista y con los fallos puestos a mano, para
// verificar que los totales salen EXACTOS y no solo "parece que funciona". Cada número de abajo está
// contado a mano sobre estos datos.
//
// Dos cuentas de Meta (A y B), tres campañas, cuatro contactos, tres clientes de Stripe, tres ventas,
// tres agendas, dos llamadas.
const AHORA = Date.parse('2026-09-14T12:00:00Z')
const hace = (h) => new Date(AHORA - h * 3600_000).toISOString()

const GOLDEN = {
  ahora: AHORA,
  // A trajo campañas; B está seleccionada y NO trajo nada → 1 incidencia.
  cuentasSeleccionadas: ['act_A', 'act_B'],
  cuentasConCampanas: ['act_A'],
  // c1 tiene venta; c2 no (su pago no está registrado) → 1 incidencia. cus_3 sin emparejar → 1.
  clientesStripe: [
    { id: 'cus_1', contactId: 'c1' },
    { id: 'cus_2', contactId: 'c2' },
    { id: 'cus_3', contactId: null },
  ],
  contactosConVenta: ['c1'],
  // s2 apunta a un contacto que no existe; s3 no tiene contacto → 2 incidencias.
  ventas: [
    { id: 's1', contactId: 'c1' },
    { id: 's2', contactId: 'c_borrado' },
    { id: 's3', contactId: null },
  ],
  contactos: ['c1', 'c2', 'c3', 'c4'],
  // camp_2 sin nada atribuido → 1 incidencia.
  campanas: [
    { id: 'camp_1', conAtribucion: true },
    { id: 'camp_2', conAtribucion: false },
    { id: 'camp_3', conAtribucion: true },
  ],
  // a3 sin contacto → 1 incidencia.
  agendas: [
    { id: 'a1', contactId: 'c1' },
    { id: 'a2', contactId: 'c3' },
    { id: 'a3', contactId: null },
  ],
  // l2 sin agenda → 1 incidencia.
  llamadas: [
    { id: 'l1', appointmentId: 'a1' },
    { id: 'l2', appointmentId: null },
  ],
  // meta reciente; stripe justo pasado de las 48 h; fathom nunca → 2 incidencias.
  ultimaSyncPorFuente: { meta: hace(2), stripe: hace(49), fathom: null },
}

const porId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]))

test('golden dataset: cada control da el número exacto contado a mano', () => {
  const c = porId(runCrossChecks(GOLDEN))
  assert.equal(c.meta_cuenta_sin_datos.afectados, 1)
  assert.deepEqual(c.meta_cuenta_sin_datos.ejemplos, ['act_B'])
  assert.equal(c.pago_stripe_sin_venta.afectados, 1)
  assert.deepEqual(c.pago_stripe_sin_venta.ejemplos, ['cus_2'])
  assert.equal(c.venta_sin_contacto.afectados, 2)
  assert.deepEqual(c.venta_sin_contacto.ejemplos, ['s2', 's3'])
  assert.equal(c.cliente_sin_emparejar.afectados, 1)
  assert.deepEqual(c.cliente_sin_emparejar.ejemplos, ['cus_3'])
  assert.equal(c.campana_sin_atribucion.afectados, 1)
  assert.equal(c.agenda_sin_contacto.afectados, 1)
  assert.equal(c.llamada_sin_agenda.afectados, 1)
  assert.equal(c.sync_obsoleta.afectados, 2)
  assert.deepEqual(c.sync_obsoleta.ejemplos, ['stripe', 'fathom'])
})

test('golden dataset: un universo sano da CERO en todos los controles', () => {
  const sano = {
    ...GOLDEN,
    cuentasConCampanas: ['act_A', 'act_B'],
    clientesStripe: [{ id: 'cus_1', contactId: 'c1' }],
    contactosConVenta: ['c1'],
    ventas: [{ id: 's1', contactId: 'c1' }],
    campanas: [{ id: 'camp_1', conAtribucion: true }],
    agendas: [{ id: 'a1', contactId: 'c1' }],
    llamadas: [{ id: 'l1', appointmentId: 'a1' }],
    ultimaSyncPorFuente: { meta: hace(1), stripe: hace(2) },
  }
  const checks = runCrossChecks(sano)
  for (const c of checks) {
    assert.equal(c.afectados, 0, `${c.id} debería estar a cero`)
    assert.equal(c.gravedad, 'ok')
  }
  assert.deepEqual(resumenCross(checks), { estado: 'ok', criticos: 0, avisos: 0, sinComprobar: 0 })
})

test('un conjunto que no se pudo leer da DESCONOCIDO, nunca cero', () => {
  // La regla más importante del módulo: decir "todo en orden" porque la consulta falló es la peor
  // respuesta posible.
  const checks = runCrossChecks({ ...GOLDEN, ventas: null, clientesStripe: null })
  const c = porId(checks)
  assert.equal(c.venta_sin_contacto.afectados, null)
  assert.equal(c.venta_sin_contacto.gravedad, 'desconocido')
  assert.equal(c.pago_stripe_sin_venta.afectados, null)
  assert.equal(c.cliente_sin_emparejar.afectados, null)
  assert.match(c.venta_sin_contacto.detalle, /No se pudo comprobar/)
})

test('el resumen prioriza crítico, y "incompleto" gana a "ok"', () => {
  assert.equal(resumenCross(runCrossChecks(GOLDEN)).estado, 'critico')
  // Solo avisos: ninguna incidencia crítica.
  const soloAvisos = {
    ...GOLDEN,
    cuentasConCampanas: ['act_A', 'act_B'],
    clientesStripe: [{ id: 'cus_3', contactId: null }],
    ventas: [{ id: 's1', contactId: 'c1' }],
    agendas: [{ id: 'a1', contactId: 'c1' }],
  }
  assert.equal(resumenCross(runCrossChecks(soloAvisos)).estado, 'aviso')
  // Todo sano salvo algo sin comprobar: no es "ok", es "incompleto".
  const incompleto = {
    ...GOLDEN,
    cuentasConCampanas: ['act_A', 'act_B'],
    clientesStripe: [{ id: 'cus_1', contactId: 'c1' }],
    ventas: [{ id: 's1', contactId: 'c1' }],
    campanas: [{ id: 'camp_1', conAtribucion: true }],
    agendas: [{ id: 'a1', contactId: 'c1' }],
    llamadas: [{ id: 'l1', appointmentId: 'a1' }],
    ultimaSyncPorFuente: null,
  }
  const r = resumenCross(runCrossChecks(incompleto))
  assert.equal(r.estado, 'incompleto')
  assert.equal(r.sinComprobar, 1)
})

test('la obsolescencia usa el umbral, y una fecha ilegible cuenta como obsoleta', () => {
  const justoDentro = runCrossChecks({
    ...GOLDEN,
    ultimaSyncPorFuente: { meta: new Date(AHORA - STALE_POR_DEFECTO_MS + 60_000).toISOString() },
  })
  assert.equal(porId(justoDentro).sync_obsoleta.afectados, 0)
  const justoFuera = runCrossChecks({
    ...GOLDEN,
    ultimaSyncPorFuente: { meta: new Date(AHORA - STALE_POR_DEFECTO_MS - 60_000).toISOString() },
  })
  assert.equal(porId(justoFuera).sync_obsoleta.afectados, 1)
  // Ni se asume fresca ni se rompe: una fecha que no se puede leer es obsoleta.
  const ilegible = runCrossChecks({ ...GOLDEN, ultimaSyncPorFuente: { meta: 'no-es-fecha' } })
  assert.equal(porId(ilegible).sync_obsoleta.afectados, 1)
})

test('los ejemplos se limitan a cinco: son para ir a mirar, no un volcado', () => {
  const muchas = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, contactId: null }))
  const c = porId(runCrossChecks({ ...GOLDEN, ventas: muchas }))
  assert.equal(c.venta_sin_contacto.afectados, 12)
  assert.equal(c.venta_sin_contacto.ejemplos.length, 5)
})

test('ningún control propone arreglar datos por su cuenta', () => {
  for (const c of runCrossChecks(GOLDEN)) {
    // Emparejar un cliente o atribuir una venta es una decisión del usuario: el control nombra el
    // problema y dice dónde resolverlo, no lo resuelve.
    assert.ok(!/autom[aá]tic/i.test(c.detalle), `${c.id} no debe prometer arreglos automáticos`)
  }
})

test('la ruta de Data Health expone los controles cruzados sin abortar por una tabla', () => {
  const ruta = readFileSync(
    new URL('../../app/api/[tenant]/evergreen/settings/data-health/route.ts', import.meta.url),
    'utf8'
  )
  assert.match(ruta, /crossSource: crossChecks/)
  assert.match(ruta, /crossSummary: resumenCross\(crossChecks\)/)
  // Las consultas extra NO cortan la respuesta: si una falla, su conjunto va como null y el control
  // dice "no se pudo comprobar" en vez de dejar la pantalla en blanco por una tabla.
  assert.match(ruta, /salesResult\.error\s*\?\s*null\s*:/)
  assert.match(ruta, /stripeResult\.error\s*\n?\s*\? null/)
  assert.match(ruta, /adAccountsResult\.error\s*\n?\s*\? null/)
  // Las cuentas seleccionadas salen de la MISMA función que usa la pantalla de Integraciones.
  assert.match(ruta, /cuentasSeleccionadas: parseAccountIds\(cfg\.META_AD_ACCOUNT_ID\)/)
  // Y "nunca sincronizada" es null, no undefined perdido.
  assert.match(ruta, /latest\(campaigns, 'synced_at'\) \?\? null/)
})
