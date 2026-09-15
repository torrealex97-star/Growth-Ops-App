import assert from 'node:assert/strict'
import test from 'node:test'
import { medirEtapa, medirVelocidad, UMBRAL_COLA_LARGA, valorPipeline } from '../../lib/metrics/velocidad.ts'
import {
  alertaAnomalia,
  alertaCalidadDato,
  alertaCapacidad,
  alertaKpi,
  detectarAnomalia,
  MAXIMO_PRIORIDADES,
  MINIMO_HISTORICO,
  ordenarAlertas,
  priorizar,
  UMBRAL_ANOMALIA,
} from '../../lib/metrics/alertas.ts'

// =============================================================================================
// VELOCIDAD DEL PIPELINE
// =============================================================================================

const rec = (id, over = {}) => ({
  id,
  leadEn: '2026-09-01T00:00:00Z',
  reservaEn: '2026-09-03T00:00:00Z',
  llamadaEn: '2026-09-05T00:00:00Z',
  cierreEn: '2026-09-06T00:00:00Z',
  primerPagoEn: '2026-09-08T00:00:00Z',
  ...over,
})

test('cada etapa mide días entre sus dos fechas', () => {
  const v = medirVelocidad([rec('a')])
  const por = Object.fromEntries(v.etapas.map((e) => [e.etapa, e.medianaDias]))
  assert.deepEqual(por, {
    lead_a_reserva: 2,
    reserva_a_llamada: 2,
    llamada_a_cierre: 1,
    cierre_a_primer_pago: 2,
    lead_a_cash: 7,
  })
  assert.equal(v.cicloMedianoDias, 7)
})

// LO QUE NO TIENE LAS DOS FECHAS NO CUENTA. Un recorrido sin cierre no es un cierre en cero días.
test('un recorrido sin la fecha de cierre no cuenta como cierre en cero días', () => {
  const e = medirEtapa([rec('a'), rec('b', { cierreEn: null })], 'llamada_a_cierre')
  assert.equal(e.muestra, 1)
  assert.equal(e.descartados, 1)
  assert.equal(e.medianaDias, 1)
  assert.match(e.nota, /1 sin las dos fechas/)
})

test('una etapa sin ningún recorrido medible vale null y lo declara', () => {
  const e = medirEtapa([rec('a', { cierreEn: null }), rec('b', { cierreEn: null })], 'llamada_a_cierre')
  assert.equal(e.medianaDias, null)
  assert.equal(e.muestra, 0)
  assert.equal(e.descartados, 2)
  assert.match(e.nota, /no se puede medir/i)
})

// LA MEDIANA MANDA. Un prospecto que firmó nueve meses después sube la media y manda al equipo a
// arreglar un problema que no existe.
test('un caso extremo mueve la media pero no la mediana, y se avisa de la cola larga', () => {
  const rapidos = Array.from({ length: 9 }, (_, i) => rec(`r${i}`, { primerPagoEn: '2026-09-08T00:00:00Z' }))
  const lento = rec('lento', { primerPagoEn: '2027-06-01T00:00:00Z' })
  const e = medirEtapa([...rapidos, lento], 'lead_a_cash')
  assert.equal(e.medianaDias, 7)
  assert.ok(e.mediaDias > 30)
  assert.ok(e.mediaDias / e.medianaDias >= UMBRAL_COLA_LARGA)
  assert.equal(e.colaLarga, true)
  assert.match(e.nota, /la media engaña/i)
})

test('sin cola larga no se inventa el aviso', () => {
  const e = medirEtapa([rec('a'), rec('b'), rec('c')], 'lead_a_cash')
  assert.equal(e.colaLarga, false)
  assert.doesNotMatch(e.nota, /engaña/i)
})

test('el p90 se da además de la mediana', () => {
  const e = medirEtapa(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 100].map((d, i) =>
      rec(`x${i}`, {
        leadEn: '2026-09-01T00:00:00Z',
        primerPagoEn: new Date(Date.parse('2026-09-01T00:00:00Z') + d * 86400000).toISOString(),
      })
    ),
    'lead_a_cash'
  )
  assert.equal(e.medianaDias, 5.5)
  assert.ok(e.p90Dias > e.medianaDias)
})

// Fechas cruzadas son un dato roto, no un recorrido rapidísimo: restarían días al promedio.
test('una duración negativa se descarta en vez de restar días', () => {
  const e = medirEtapa([rec('a'), rec('roto', { cierreEn: '2026-08-01T00:00:00Z' })], 'llamada_a_cierre')
  assert.equal(e.muestra, 1)
  assert.equal(e.descartados, 1)
  assert.equal(e.medianaDias, 1)
})

test('una fecha ilegible se descarta sin lanzar', () => {
  const e = medirEtapa([rec('a', { cierreEn: 'no-es-una-fecha' })], 'llamada_a_cierre')
  assert.equal(e.muestra, 0)
  assert.equal(e.descartados, 1)
})

test('la etapa más lenta no puede ser el ciclo completo, que las contiene todas', () => {
  const v = medirVelocidad([
    rec('a', {
      reservaEn: '2026-09-20T00:00:00Z',
      llamadaEn: '2026-09-21T00:00:00Z',
      cierreEn: '2026-09-22T00:00:00Z',
      primerPagoEn: '2026-09-23T00:00:00Z',
    }),
  ])
  assert.equal(v.masLenta, 'lead_a_reserva')
  assert.notEqual(v.masLenta, 'lead_a_cash')
})

test('sin recorridos no se inventa velocidad', () => {
  const v = medirVelocidad([])
  assert.equal(v.cicloMedianoDias, null)
  assert.equal(v.masLenta, null)
  assert.match(v.titular, /aún no hay recorridos/i)
})

// El pipeline bruto asume que todo cierra: como número de planificación es fantasía.
test('el valor ponderado excluye lo que no tiene probabilidad y lo dice', () => {
  const v = valorPipeline([
    { id: 'a', valorEur: 2000, probabilidad: 0.25 },
    { id: 'b', valorEur: 2000, probabilidad: null },
  ])
  assert.equal(v.valorBrutoEur, 4000)
  assert.equal(v.valorPonderadoEur, 500)
  assert.equal(v.sinProbabilidad, 1)
  assert.match(v.nota, /1 sin probabilidad, excluidas/)
})

test('sin ninguna probabilidad no hay ponderado, y se advierte de que el bruto no sirve para caja', () => {
  const v = valorPipeline([{ id: 'a', valorEur: 5000, probabilidad: null }])
  assert.equal(v.valorPonderadoEur, null)
  assert.match(v.nota, /no sirve para planificar caja/i)
})

test('una probabilidad imposible no entra en el ponderado', () => {
  const v = valorPipeline([
    { id: 'a', valorEur: 1000, probabilidad: 1.8 },
    { id: 'b', valorEur: 1000, probabilidad: -1 },
  ])
  assert.equal(v.valorPonderadoEur, null)
  assert.equal(v.conProbabilidad, 0)
})

// =============================================================================================
// ALERTAS Y ANOMALÍAS
// =============================================================================================

// LA REGLA DE LA MUESTRA: con tres observaciones cualquier cuarto valor es "anómalo".
test('sin histórico suficiente no se detecta ninguna anomalía', () => {
  assert.equal(MINIMO_HISTORICO, 7)
  assert.equal(detectarAnomalia(100, [1, 2, 3]), null)
  assert.equal(detectarAnomalia(100, []), null)
  assert.ok(detectarAnomalia(100, [1, 1, 1, 1, 2, 1, 1]) !== null)
})

// LA MAD, NO SIGMA: la desviación típica la infla el propio valor extremo que se quiere detectar.
test('un pico se detecta aunque la desviación típica lo camuflaría', () => {
  const historico = [10, 11, 9, 10, 12, 10, 11, 10]
  const a = detectarAnomalia(90, historico, { higherIsBetter: true })
  assert.equal(a.esAnomalia, true)
  assert.ok(Math.abs(a.puntuacion) >= UMBRAL_ANOMALIA)
  assert.match(a.motivo, /mediana histórica de 10/)
  assert.match(a.motivo, /8 observaciones/)
})

test('un valor normal no se marca como anomalía', () => {
  const a = detectarAnomalia(11, [10, 11, 9, 10, 12, 10, 11, 10])
  assert.equal(a.esAnomalia, false)
  assert.match(a.motivo, /dentro de lo habitual/i)
})

// Un pico de ventas también es una anomalía, y es buena noticia.
test('una anomalía a mejor se marca como favorable y no dispara alarma', () => {
  const historico = [10, 11, 9, 10, 12, 10, 11, 10]
  const buena = detectarAnomalia(90, historico, { higherIsBetter: true })
  assert.equal(buena.favorable, true)
  const alerta = alertaAnomalia({ key: 'ventas', nombre: 'Ventas', valor: 90, anomalia: buena })
  assert.equal(alerta.severidad, 'INFO')
  assert.equal(alerta.favorable, true)
  assert.match(alerta.titulo, /a mejor/)
  assert.match(alerta.accion, /repetirlo/i)

  // Y en una métrica de coste, el mismo pico es mala noticia.
  const mala = detectarAnomalia(90, historico, { higherIsBetter: false })
  assert.equal(mala.favorable, false)
  assert.equal(alertaAnomalia({ key: 'cpl', nombre: 'CPL', valor: 90, anomalia: mala }).severidad, 'WARNING')
})

test('sin saber la dirección buena no se afirma si la anomalía es favorable', () => {
  assert.equal(detectarAnomalia(90, [10, 11, 9, 10, 12, 10, 11, 10]).favorable, null)
})

test('un histórico constante no produce una puntuación infinita', () => {
  const a = detectarAnomalia(50, [10, 10, 10, 10, 10, 10, 10])
  assert.equal(a.esAnomalia, true)
  assert.equal(a.puntuacion, null)
  assert.equal(a.mad, 0)
  assert.match(a.motivo, /sin variabilidad previa/i)
  assert.ok(Number.isFinite(a.mediana))

  const igual = detectarAnomalia(10, [10, 10, 10, 10, 10, 10, 10])
  assert.equal(igual.esAnomalia, false)
})

// ---------------------------------------------------------------------------------------------
// CALLARSE ES LA FUNCIÓN. Un panel que avisa de doce cosas cada mañana se ignora en tres días.
// ---------------------------------------------------------------------------------------------

const kpi = (key, desvio) =>
  alertaKpi({ key, nombre: key, valor: 1, objetivo: 2, higherIsBetter: true, desvioRelativo: desvio, muestra: 100 })

test('nunca hay más de tres prioridades, y el resto no se pierde', () => {
  assert.equal(MAXIMO_PRIORIDADES, 3)
  const { prioridades, resto } = priorizar([
    kpi('a', 0.5),
    kpi('b', 0.4),
    kpi('c', 0.3),
    kpi('d', 0.25),
    alertaCalidadDato({ key: 'x', que: 'origen de los contactos', detalle: '0 de 956 con campaña.' }),
  ])
  assert.equal(prioridades.length, 3)
  assert.equal(resto.length, 2)
})

test('lo crítico va antes que el aviso, y a igualdad manda lo que mueve dinero', () => {
  const orden = ordenarAlertas([
    alertaCalidadDato({ key: 'd', que: 'algo', detalle: '.' }),
    alertaCapacidad({ area: 'Ventas', utilizacion: 75 }),
    kpi('kpi_leve', 0.1),
    kpi('kpi_critico', 0.5),
  ]).map((a) => a.categoria + ':' + a.severidad)
  assert.deepEqual(orden, ['KPI:CRITICAL', 'KPI:WARNING', 'CAPACIDAD:WARNING', 'CALIDAD_DATO:WARNING'])
})

// La calidad de dato es importante y nunca urgente: no cambia la decisión de hoy.
test('la calidad de dato nunca desplaza a un problema de negocio ni llega a CRITICAL', () => {
  const dato = alertaCalidadDato({ key: 'campanas', que: 'la campaña de cada contacto', detalle: '0 de 956.' })
  assert.equal(dato.severidad, 'WARNING')
  assert.match(dato.detalle, /no se rellenan con ceros/i)
  const { prioridades } = priorizar([dato, kpi('a', 0.1), kpi('b', 0.1), kpi('c', 0.1)])
  assert.ok(!prioridades.some((a) => a.categoria === 'CALIDAD_DATO'))
})

test('una anomalía favorable nunca adelanta a un problema', () => {
  const buena = alertaAnomalia({
    key: 'ventas',
    nombre: 'Ventas',
    valor: 90,
    anomalia: detectarAnomalia(90, [10, 11, 9, 10, 12, 10, 11, 10], { higherIsBetter: true }),
  })
  const orden = ordenarAlertas([buena, kpi('malo', 0.1)])
  assert.equal(orden[0].metricaKey, 'malo')
})

test('la capacidad al 90% es crítica y no se confunde con optimizar conversión', () => {
  const a = alertaCapacidad({ area: 'Entrega', utilizacion: 92 })
  assert.equal(a.severidad, 'CRITICAL')
  assert.match(a.detalle, /no se arregla optimizando/i)
  assert.equal(alertaCapacidad({ area: 'Ventas', utilizacion: 75 }).severidad, 'WARNING')
})

test('la alerta de KPI dice los números y la dirección correcta', () => {
  const alto = alertaKpi({
    key: 'cac',
    nombre: 'CAC',
    valor: 800,
    objetivo: 500,
    higherIsBetter: false,
    desvioRelativo: 0.6,
    muestra: 27,
    investigar: ['Revisar el CPL por campaña'],
  })
  assert.equal(alto.severidad, 'CRITICAL')
  assert.match(alto.detalle, /por encima/)
  assert.match(alto.detalle, /27 observaciones/)
  assert.equal(alto.accion, 'Revisar el CPL por campaña')
  assert.equal(
    alertaKpi({
      key: 'x',
      nombre: 'X',
      valor: 1,
      objetivo: 2,
      higherIsBetter: true,
      desvioRelativo: 0.1,
      muestra: null,
    }).severidad,
    'WARNING'
  )
})

test('cada alerta tiene un id estable por métrica para poder deduplicar', () => {
  assert.equal(kpi('close_rate', 0.3).id, 'kpi:close_rate')
  assert.equal(
    priorizar([kpi('a', 0.3), kpi('a', 0.3)]).prioridades.length,
    2,
    'la dedupe es de quien las genera, no de aquí'
  )
})

test('sin alertas no se devuelve nada inventado', () => {
  const { prioridades, resto } = priorizar([])
  assert.deepEqual(prioridades, [])
  assert.deepEqual(resto, [])
})
