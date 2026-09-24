import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ETIQUETAS_CONFIDENCE,
  METRICAS_VERSIONADAS,
  PENDIENTES_DE_MOTOR,
  buscarMetrica,
  definicionVersionada,
  evaluarDefinicion,
} from '../../lib/metrics/definiciones.ts'
import { TODAS_LAS_METRICAS } from '../../lib/metrics/registro.ts'
import { calcularAgregados } from '../../lib/metrics/agregados.ts'

// F3 — GOLDEN FIXTURES DEL CONTRATO DE MÉTRICA.
//
// Lo que el plan pide, literal: "misma definición y filtros dan el mismo número en UI, API e IA;
// casos de late events, cohorte vs periodo y ventana de madurez".
//
// CÓMO: el motor (`agregados.ts`) es puro, así que las mismas filas producen SIEMPRE el mismo
// número. Estos fixtures congelan ese número y, sobre todo, congelan que el resultado viaje con su
// contrato (versión, grain, madurez, confianza y linaje): una cifra sin contrato no es comparable
// entre pantallas, que es justo el fallo que F3 viene a cerrar.

const P = { desde: '2026-09-01', hasta: '2026-09-30' }
const vacio = { ventas: [], cobros: [], citas: [], campanas: [], contactos: [], periodo: P }
const con = (over) => calcularAgregados({ ...vacio, ...over })
const evalua = (clave, medicion, opts) => evaluarDefinicion(clave, medicion, opts)

// ── EL CONTRATO EXISTE PARA TODO LO QUE SE PUBLICA ───────────────────────────────────────────

test('toda métrica del registro con consumo de UI tiene contrato versionado', () => {
  // Las claves del motor son las que pintan las pantallas. Si el motor calcula una y no hay
  // contrato, una cifra viaja sin versión ni linaje: es lo que F3 prohíbe.
  const sinContrato = TODAS_LAS_METRICAS.filter((m) => !METRICAS_VERSIONADAS.has(m.key)).map((m) => m.key)
  // ltgp_cac tiene contrato aunque el motor lo devuelva siempre sin dato (hueco LTGP real).
  assert.deepEqual(sinContrato, [], 'toda métrica del registro necesita su contrato de publicación')
})

test('cada contrato declara version, grain y lineage — nada opcional', () => {
  for (const [clave, def] of METRICAS_VERSIONADAS) {
    assert.ok(Number.isInteger(def.version) && def.version >= 1, `${clave}: version obligatoria`)
    assert.ok(def.grain === 'period' || def.grain === 'cohort', `${clave}: grain obligatorio`)
    assert.ok(Array.isArray(def.lineage.fuentes), `${clave}: lineage.fuentes obligatorio`)
    assert.ok(Array.isArray(def.lineage.dependeDe), `${clave}: lineage.dependeDe obligatorio`)
  }
})

test('las dependencias del lineage existen como métricas', () => {
  for (const [, def] of METRICAS_VERSIONADAS) {
    for (const dep of def.lineage.dependeDe) {
      assert.ok(METRICAS_VERSIONADAS.has(dep), `${def.key} depende de "${dep}", que no tiene contrato ni definición`)
    }
  }
})

test('la definición versionada conserva la semántica del registro canónico', () => {
  const show = definicionVersionada('show_rate')
  const registro = buscarMetrica('show_rate')
  assert.ok(show && registro)
  assert.equal(show.formula, registro.formula, 'una segunda fórmula aquí sería otra métrica')
  assert.equal(show.higherIsBetter, registro.higherIsBetter)
  assert.equal(show.targetType, registro.targetType)
})

// ── MISMA DEFINICIÓN, MISMO NÚMERO — el corazón del test dorado ─────────────────────────────

test('GOLDEN show_rate: 34 resueltas con 24 shows = 70.59, y viaja con contrato', () => {
  const citas = [
    ...Array.from({ length: 24 }, (_, i) => ({
      appointment_datetime: `2026-09-0${(i % 9) + 1}T10:00:00Z`,
      status: 'show',
      offered: true,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      appointment_datetime: `2026-09-1${i % 9}T10:00:00Z`,
      status: 'no_show',
      offered: false,
    })),
    // Una cancelada NO entra al denominador (regla del motor congelada aquí también).
    { appointment_datetime: '2026-09-20T10:00:00Z', status: 'cancelled_lead', offered: null },
  ]
  const m = con({ citas })
  const publicada = evalua('show_rate', m.show_rate, { ahora: new Date('2026-10-25T00:00:00Z') })

  assert.equal(publicada.value, 70.59)
  assert.equal(publicada.metricVersion, 1)
  assert.equal(publicada.grain, 'period')
  assert.equal(publicada.maturityStatus, 'madura')
  assert.equal(publicada.dataConfidence, null)
  assert.deepEqual(publicada.lineage.fuentes, ['appointments'])
})

test('GOLDEN close_rate_llamadas: 24 shows y 6 ventas con cita = 25', () => {
  const citas = Array.from({ length: 24 }, (_, i) => ({
    appointment_datetime: `2026-09-0${(i % 9) + 1}T10:00:00Z`,
    status: 'show',
  }))
  const ventas = Array.from({ length: 6 }, (_, i) => ({
    sale_date: `2026-09-1${i}`,
    gross_amount: 1997,
    status: 'active',
    appointment_id: `apt_${i}`,
  }))
  const m = con({ citas, ventas })
  const publicada = evalua('close_rate_llamadas', m.close_rate_llamadas)
  assert.equal(publicada.value, 25)
  assert.deepEqual(publicada.lineage.fuentes, ['appointments', 'sales'])
})

test('GOLDEN CAC: 10.000 de gasto y 8 ventas = 1250, con muestra mínima respetada', () => {
  const campanas = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    spend: 333.33,
    impressions: 1000,
    clicks: 10,
    leads: 1,
  }))
  const ventas = Array.from({ length: 8 }, (_, i) => ({
    sale_date: `2026-09-1${i}`,
    gross_amount: 1997,
    status: 'active',
  }))
  const m = con({ campanas, ventas })
  const publicada = evalua('cac', m.cac)
  assert.equal(publicada.value, 1249.99) // 9999.9 / 8 — el redondeo r2 del motor, congelado
  assert.equal(publicada.dataConfidence, null, '8 ventas alcanzan la muestra mínima declarada')
})

test('GOLDEN cash_roas: 30 días de gasto, 6 cobros = cash/gasto exacto', () => {
  const campanas = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    spend: 100,
    impressions: 1000,
    clicks: 10,
    leads: 1,
  }))
  const cobros = Array.from({ length: 6 }, (_, i) => ({
    collected_at: `2026-09-1${i}T10:00:00Z`,
    gross_amount: 500,
    is_confirmed: true,
  }))
  const m = con({ campanas, cobros })
  const publicada = evalua('cash_roas', m.cash_roas)
  assert.equal(publicada.value, 1) // 3000 / 3000
  // MER es la misma división declarada como pendiente: no puede divergir cuando exista.
  const mer = PENDIENTES_DE_MOTOR.find((d) => d.key === 'mer')
  assert.match(mer.formula, /Cash Collected/)
  assert.match(mer.formula, /Inversión publicitaria/)
})

// ── ETIQUETAR, NO SUSTITUIR ──────────────────────────────────────────────────────────────────

test('muestra insuficiente ETIQUETA el valor, no lo borra ni lo pone a cero', () => {
  const citas = [
    { appointment_datetime: '2026-09-05T10:00:00Z', status: 'show', offered: true },
    { appointment_datetime: '2026-09-06T10:00:00Z', status: 'no_show', offered: false },
  ]
  const m = con({ citas })
  assert.equal(m.show_rate.valor, 50) // el número existe
  const publicada = evalua('show_rate', m.show_rate)
  assert.equal(publicada.value, 50, 'el valor sigue ahí')
  assert.equal(publicada.dataConfidence, 'muestra_insuficiente')
  assert.match(ETIQUETAS_CONFIDENCE.muestra_insuficiente, /Pocos datos/)
})

test('en maduración: la etiqueta de maduración tapa la de muestra, y el valor no se toca', () => {
  const medicion = { valor: 70, muestra: 40 }
  const publicada = evalua('show_rate', medicion, { enMaduracion: true })
  assert.equal(publicada.value, 70)
  assert.equal(publicada.dataConfidence, 'en_maduracion')
  assert.equal(publicada.maturityStatus, 'madura', 'la madurez la declara quien consulta, no el evaluador')
})

test('sin valor no hay aviso de confianza: hay motivo, y es el del motor', () => {
  const m = con({})
  const publicada = evalua('show_rate', m.show_rate)
  assert.equal(publicada.value, null)
  assert.equal(publicada.dataConfidence, null)
  assert.match(publicada.motivo, /No hay citas agendadas/)
})

test('una métrica sin contrato sale null: no se publica sin contrato', () => {
  assert.equal(evalua('clave_inexistente', { valor: 1, muestra: 1 }), null)
})

// ── COHORTE vs PERIODO: dos grains, dos preguntas, sin mezclarlas ────────────────────────────

test('grain cohort vs period: el contratado por periodo y el de cohorte NO son el mismo número', () => {
  // Periodo septiembre: solo entran ventas con sale_date en septiembre.
  const ventasSept = [{ sale_date: '2026-09-10', gross_amount: 1997, status: 'active' }]
  const m = con({ ventas: ventasSept })
  assert.equal(m.contracted_revenue.valor, 1997)

  // La misma venta vista como cohorte de agosto (por sale_date de origen) no existe: la cohorte de
  // agosto agrupa por fecha de ORIGEN, y esta venta nació en septiembre. El contrato lo declara
  // (grain) para que ninguna pantalla compare un dato con el otro.
  const def = definicionVersionada('contracted_revenue')
  assert.equal(def.grain, 'period')
  assert.equal(def.ventanaMaduracionDias, 45, 'los cobros de una venta de septiembre llegan en meses siguientes')
})

// ── LAS PENDIENTES DECLARADAS: definición primero, cálculo después ───────────────────────────

test('MER y refund_rate están declaradas con fórmula y motivo, y NO calculadas a medias', () => {
  const claves = PENDIENTES_DE_MOTOR.map((d) => d.key)
  assert.deepEqual(claves, ['mer', 'refund_rate'])
  for (const d of PENDIENTES_DE_MOTOR) {
    assert.ok(d.formula.length > 10, `${d.key}: fórmula documentada`)
    assert.ok(d.porQuePendiente.length > 20, `${d.key}: el porqué de no calcularla hoy`)
    // Que NO esté en el contrato de publicación es lo que evita que una pantalla la pinte vacía o a 0.
    assert.equal(METRICAS_VERSIONADAS.has(d.key), false, `${d.key} no puede publicarse sin motor`)
  }
})
