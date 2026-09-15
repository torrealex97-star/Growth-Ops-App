import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DIMENSION_POR_METRICA,
  entradasDiagnostico,
  entradasSalud,
  INVESTIGAR_POR_METRICA,
  NIVEL_POR_METRICA,
} from '../../lib/metrics/entradas.ts'
import { calcularAgregados } from '../../lib/metrics/agregados.ts'
import { diagnosticarCuelloBotella } from '../../lib/metrics/cuello-botella.ts'
import { calcularSalud } from '../../lib/metrics/salud.ts'
import { TODAS_LAS_METRICAS, buscarMetrica } from '../../lib/metrics/registro.ts'

const P = { desde: '2026-09-01', hasta: '2026-09-30' }

// =============================================================================================
// EL PUENTE NO PUEDE INVENTAR NADA. Objetivos y nombres salen del registro; si cada pantalla pusiera
// los suyos, dos pantallas dirían que la misma métrica cumple y no cumple.
// =============================================================================================

test('todas las métricas con nivel existen en el registro', () => {
  const claves = new Set(TODAS_LAS_METRICAS.map((m) => m.key))
  for (const clave of Object.keys(NIVEL_POR_METRICA)) {
    assert.ok(claves.has(clave), `NIVEL_POR_METRICA tiene "${clave}", que no está en el registro`)
  }
  for (const clave of Object.keys(DIMENSION_POR_METRICA)) {
    assert.ok(claves.has(clave), `DIMENSION_POR_METRICA tiene "${clave}", que no está en el registro`)
  }
  for (const clave of Object.keys(INVESTIGAR_POR_METRICA)) {
    assert.ok(claves.has(clave), `INVESTIGAR_POR_METRICA tiene "${clave}", que no está en el registro`)
  }
})

test('el objetivo y el nombre vienen del registro, no del puente', () => {
  const agregados = { close_rate_llamadas: { valor: 12, muestra: 200 } }
  const [e] = entradasDiagnostico(agregados)
  const def = buscarMetrica('close_rate_llamadas')
  assert.equal(e.nombre, def.name)
  assert.equal(e.objetivo, def.target ?? null)
  assert.equal(e.higherIsBetter, def.higherIsBetter)
})

// Una métrica sin nivel no se puede ordenar en la jerarquía. Colocarla "donde sea" haría que el
// diagnóstico dependiera del orden de las claves del objeto.
test('una métrica sin nivel declarado no entra en el diagnóstico', () => {
  const entradas = entradasDiagnostico({ inventada_xyz: { valor: 1, muestra: 10 } })
  assert.deepEqual(entradas, [])
})

test('la jerarquía asigna el nivel correcto a las métricas que deciden', () => {
  assert.equal(NIVEL_POR_METRICA.ltgp_cac, 'economia')
  assert.equal(NIVEL_POR_METRICA.cac, 'economia')
  assert.equal(NIVEL_POR_METRICA.cash_roas, 'caja')
  assert.equal(NIVEL_POR_METRICA.close_rate_llamadas, 'ventas')
  assert.equal(NIVEL_POR_METRICA.show_rate, 'oportunidades')
  assert.equal(NIVEL_POR_METRICA.ctr, 'trafico')
})

// =============================================================================================
// LA TUBERÍA COMPLETA, de filas a diagnóstico, sin red.
// =============================================================================================

test('de filas crudas a una restricción con su acción', () => {
  const agregados = calcularAgregados({
    periodo: P,
    // Economía sana: 500 € de gasto, 2 ventas, 2.000 € cobrados → ROAS 4, CAC 250.
    campanas: [{ date: '2026-09-10', spend: 500, impressions: 100_000, clicks: 2000, leads: 50 }],
    ventas: [
      { sale_date: '2026-09-11', gross_amount: 1997, status: 'active', appointment_id: 'a1' },
      { sale_date: '2026-09-12', gross_amount: 1997, status: 'active', appointment_id: 'a2' },
    ],
    cobros: [{ collected_at: '2026-09-12T10:00:00Z', gross_amount: 2000, is_confirmed: true }],
    // Y un show rate malo: 2 de 10.
    citas: Array.from({ length: 10 }, (_, i) => ({
      appointment_datetime: '2026-09-10T10:00:00Z',
      status: i < 2 ? 'show' : 'no_show',
    })),
  })

  const d = diagnosticarCuelloBotella(entradasDiagnostico(agregados), {
    muestraAlta: 100,
    muestraMinima: 5,
    umbralCritico: 0.2,
    ticketMedioEur: 1997,
    volumenBase: 10,
  })
  assert.ok(d.primaria, 'debería encontrar una restricción')
  // El show rate del 20% contra un objetivo de 65-70 es lo que está roto, y la economía está sana.
  assert.equal(d.primaria.key, 'show_rate')
  assert.ok(d.primaria.investigar.length > 0, 'la restricción tiene que decir qué mirar')
  assert.match(d.primaria.investigar.join(' '), /recordatorios/i)
})

test('la salud se agrupa por dimensión y sale reproducible', () => {
  const agregados = calcularAgregados({
    periodo: P,
    campanas: [{ date: '2026-09-10', spend: 500, impressions: 100_000, clicks: 2000, leads: 50 }],
    ventas: [{ sale_date: '2026-09-11', gross_amount: 1997, status: 'active', appointment_id: 'a1' }],
    cobros: [{ collected_at: '2026-09-12T10:00:00Z', gross_amount: 1997, is_confirmed: true }],
    citas: [{ appointment_datetime: '2026-09-10T10:00:00Z', status: 'show', offered: true }],
  })
  const porDimension = entradasSalud(agregados)
  assert.ok(Object.keys(porDimension).length >= 2)
  const salud = calcularSalud(porDimension)
  // Cada subscore arrastra sus componentes: es lo que hace que la nota se pueda discutir.
  for (const sub of salud.subscores) assert.ok(sub.componentes.length > 0, sub.dimension)
})

// Sin datos, el puente no debe producir un diagnóstico: debe producir huecos.
test('sin datos no hay restricción, hay huecos de medición', () => {
  const agregados = calcularAgregados({ ventas: [], cobros: [], citas: [], campanas: [], periodo: P })
  const d = diagnosticarCuelloBotella(entradasDiagnostico(agregados))
  assert.equal(d.primaria, null)
  assert.ok(d.sinDatos.length > 0)
  assert.match(d.titular, /sin datos/i)
})

// =============================================================================================
// EL OBJETIVO SE LEE SEGÚN CÓMO ESTÉ DECLARADO. El registro usa cuatro formas y solo TRES métricas
// tienen un `target` escalar: leer solo `def.target` dejaba al motor mirando 3 métricas de 20, sin
// fallar y sin diagnosticar nada. Un motor que calla no se distingue de un negocio sano.
// =============================================================================================

test('el objetivo se resuelve para cada tipo declarado', async () => {
  const { objetivoDe } = await import('../../lib/metrics/entradas.ts')
  assert.equal(objetivoDe({ targetType: 'minimo', target: 3, higherIsBetter: true }), 3)
  assert.equal(objetivoDe({ targetType: 'maximo', target: 400, higherIsBetter: false }), 400)
  // En un rango manda el extremo QUE DUELE: el suelo si más es mejor, el techo si menos es mejor.
  assert.equal(objetivoDe({ targetType: 'rango', targetMin: 65, targetMax: 70, higherIsBetter: true }), 65)
  assert.equal(objetivoDe({ targetType: 'rango', targetMin: 1, targetMax: 5, higherIsBetter: false }), 5)
  // Sin objetivo declarado no se finge uno.
  assert.equal(objetivoDe({ targetType: 'ninguno', higherIsBetter: true }), null)
  assert.equal(objetivoDe({ higherIsBetter: true }), null)
})

test('el show rate, que va por rango, llega al motor con objetivo', () => {
  const [e] = entradasDiagnostico({ show_rate: { valor: 20, muestra: 10 } })
  assert.equal(e.key, 'show_rate')
  assert.equal(e.objetivo, 65, 'sin esto el show rate nunca se diagnosticaba')
})

test('las métricas sin objetivo llegan con null y no con un objetivo inventado', () => {
  const [e] = entradasDiagnostico({ cash_collected: { valor: 1000, muestra: 5 } })
  assert.equal(e.objetivo, null)
})

// Cuántas métricas puede juzgar de verdad el motor: si esto baja, alguien ha roto el puente.
test('el motor puede juzgar más de tres métricas', () => {
  const agregados = Object.fromEntries(Object.keys(NIVEL_POR_METRICA).map((k) => [k, { valor: 1, muestra: 100 }]))
  const conObjetivo = entradasDiagnostico(agregados).filter((e) => e.objetivo !== null)
  assert.ok(conObjetivo.length >= 4, `solo ${conObjetivo.length} métricas tienen objetivo utilizable`)
})
