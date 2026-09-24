import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { NORMALIZADORES, decidir, reprocesar } from '../lib/eventos/replay.ts'
import { NORMALIZADOR_GHL } from '../lib/eventos/ghl.ts'
import { TENANT_A, TENANT_B } from './fixtures/tenants-sinteticos.mjs'

// F1 — REPROCESAR UN RANGO.
//
// El 22-sep el normalizador guardaba `no-show` como "programada". Arreglarlo sirvió para lo
// siguiente; las citas ya mal traducidas se quedaron mal. Con el sobre original guardado, esto
// vuelve a derivar el hecho con el normalizador corregido.
//
// Lo que no puede fallar: que no toque el sobre (es la prueba), que reprocesar dos veces deje el
// mismo estado, que la simulación no escriba NADA, y que se pueda continuar donde lo dejó — una
// función de Vercel muere a los 60 s y un mes no cabe en una pasada.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ruta = readFileSync(join(root, 'app/api/[tenant]/evergreen/eventos/replay/route.ts'), 'utf8')

const sobre = (extra = {}) => ({
  id: 'raw_1',
  source: 'ghl',
  source_event_id: 'wh_1',
  normalizer_version: null,
  payload: { appointmentId: 'apt_1', status: 'no-show' },
  received_at: '2026-09-22T10:00:00.000Z',
  canonical_event_id: null,
  ...extra,
})

/** Doble del cliente: registra lo que se le pide y devuelve los sobres que se le indiquen. */
function sbFalso(sobres = [], { errorHecho = null } = {}) {
  const ops = []
  const consulta = (tabla) => {
    const filtros = {}
    const q = {
      select() {
        return q
      },
      eq(col, val) {
        filtros[col] = val
        return q
      },
      gte(col, val) {
        filtros[`${col}>=`] = val
        return q
      },
      lte(col, val) {
        filtros[`${col}<=`] = val
        return q
      },
      or(expr) {
        filtros.or = expr
        return q
      },
      order() {
        return q
      },
      limit(n) {
        // Devuelve el propio constructor (como Supabase), no una promesa: el runner encadena `.or()`
        // DESPUÉS del límite para continuar desde el cursor, y con una promesa ahí eso reventaría.
        filtros.limit = n
        ops.push({ tabla, tipo: 'select', filtros })
        return q
      },
      maybeSingle() {
        return Promise.resolve({ data: { id: 'canon_1' }, error: errorHecho })
      },
      then(res) {
        // Solo la consulta de sobres devuelve filas; las escrituras resuelven vacías.
        return Promise.resolve({ data: filtros.limit === undefined ? null : sobres, error: null }).then(res)
      },
    }
    return q
  }
  return {
    ops,
    from(tabla) {
      return {
        select: () => consulta(tabla).select(),
        upsert(fila, opts) {
          ops.push({ tabla, tipo: 'upsert', fila, opts })
          return consulta(tabla)
        },
        update(valores) {
          ops.push({ tabla, tipo: 'update', valores, filtros: {} })
          return consulta(tabla)
        },
      }
    },
  }
}

const rango = { tenantId: TENANT_A.id, source: 'ghl', desde: '2026-09-22', hasta: '2026-09-23' }

// ── QUÉ HACER CON CADA SOBRE ─────────────────────────────────────────────────────────────────

test('un sobre sin hecho se reprocesa', () => {
  assert.equal(decidir(sobre(), NORMALIZADOR_GHL), 'reprocesar')
})

test('un sobre procesado con OTRA versión del normalizador se reprocesa', () => {
  assert.equal(
    decidir(sobre({ canonical_event_id: 'c1', normalizer_version: 'ghl-0' }), NORMALIZADOR_GHL),
    'reprocesar'
  )
})

test('un sobre ya al día NO se reprocesa: daría el mismo hecho', () => {
  const alDia = sobre({ canonical_event_id: 'c1', normalizer_version: NORMALIZADOR_GHL })
  assert.equal(decidir(alDia, NORMALIZADOR_GHL), 'al_dia')
})

test('una fuente sin normalizador se declara, no se inventa un hecho', () => {
  // El sobre se guardó igual (eso es lo importante); derivar el hecho requiere saber interpretarlo.
  assert.equal(decidir(sobre({ source: 'lo_que_sea' }), undefined), 'sin_normalizador')
  assert.deepEqual(Object.keys(NORMALIZADORES).sort(), ['ghl', 'stripe'])
})

// ── LA SIMULACIÓN NO ESCRIBE ─────────────────────────────────────────────────────────────────

test('en simulación no se escribe absolutamente nada', () => {
  const sb = sbFalso([sobre()])
  return reprocesar(sb, { ...rango, simulacion: true }).then((r) => {
    assert.equal(r.reprocesados, 1)
    assert.equal(r.simulacion, true)
    assert.equal(
      sb.ops.some((o) => o.tipo === 'upsert' || o.tipo === 'update'),
      false,
      'una simulación que escribe no es una simulación'
    )
    // Y aun así explica qué haría, con el tipo de hecho que saldría.
    assert.equal(r.muestra[0].accion, 'reprocesar')
    assert.equal(r.muestra[0].tipo, 'ghl.cita.registrada')
  })
})

// ── LO QUE SE ESCRIBE, Y LO QUE NO ───────────────────────────────────────────────────────────

test('el hecho se actualiza por su identidad: reprocesar dos veces no duplica', async () => {
  const sb = sbFalso([sobre()])
  await reprocesar(sb, { ...rango, simulacion: false })
  const upsert = sb.ops.find((o) => o.tabla === 'canonical_events' && o.tipo === 'upsert')
  assert.equal(upsert.opts.onConflict, 'tenant_id,source,source_event_id')
  assert.equal(upsert.fila.tenant_id, TENANT_A.id)
  assert.notEqual(upsert.fila.tenant_id, TENANT_B.id)
})

test('EL SOBRE NO SE TOCA: solo se anota con qué versión se procesó', async () => {
  // `raw_events.payload` es la prueba. Si el reprocesado lo reescribiera, la siguiente vez que el
  // normalizador mejore ya no habría original del que partir.
  const sb = sbFalso([sobre()])
  await reprocesar(sb, { ...rango, simulacion: false })
  const update = sb.ops.find((o) => o.tabla === 'raw_events' && o.tipo === 'update')
  assert.deepEqual(Object.keys(update.valores).sort(), ['canonical_event_id', 'normalizer_version', 'processed_at'])
  assert.equal(update.valores.normalizer_version, NORMALIZADOR_GHL)
})

test('el reprocesado no reasigna a quién pertenece el hecho', async () => {
  // Los vínculos con contacto y cita los puso la proyección cuando el evento llegó. Este runner no
  // sabe más que ella: pisarlos con null borraría información buena.
  const sb = sbFalso([sobre()])
  await reprocesar(sb, { ...rango, simulacion: false })
  const upsert = sb.ops.find((o) => o.tipo === 'upsert')
  assert.equal(upsert.fila.contact_id, undefined)
  assert.equal(upsert.fila.appointment_id, undefined)
})

test('un fallo escribiendo un hecho se cuenta y no corta la tanda', async () => {
  const sb = sbFalso([sobre(), sobre({ id: 'raw_2', source_event_id: 'wh_2' })], {
    errorHecho: { message: 'permission denied' },
  })
  const r = await reprocesar(sb, { ...rango, simulacion: false })
  assert.equal(r.fallidos, 2)
  assert.equal(r.reprocesados, 0)
  assert.ok(
    r.muestra.some((m) => /permission denied/.test(m.motivo ?? '')),
    'el motivo del fallo tiene que quedar en la muestra'
  )
})

// ── REANUDABLE ───────────────────────────────────────────────────────────────────────────────

test('el cursor apunta al último sobre leído', async () => {
  const sb = sbFalso([sobre(), sobre({ id: 'raw_9', received_at: '2026-09-22T11:00:00.000Z' })])
  const r = await reprocesar(sb, { ...rango, simulacion: true, limite: 2 })
  assert.deepEqual(r.cursor, { recibidoEn: '2026-09-22T11:00:00.000Z', id: 'raw_9' })
})

test('cuando se acaba el rango, el cursor es null: no hay que adivinarlo', async () => {
  const sb = sbFalso([sobre()])
  const r = await reprocesar(sb, { ...rango, simulacion: true, limite: 50 })
  assert.equal(r.cursor, null)
})

test('continuar desde un cursor no repite ni se salta el sobre del mismo milisegundo', async () => {
  const sb = sbFalso([])
  await reprocesar(sb, {
    ...rango,
    simulacion: true,
    cursor: { recibidoEn: '2026-09-22T10:00:00.000Z', id: 'raw_1' },
  })
  const select = sb.ops.find((o) => o.tipo === 'select')
  assert.match(select.filtros.or, /received_at\.gt\./)
  assert.match(select.filtros.or, /received_at\.eq[\s\S]*id\.gt\./)
})

// ── LA RUTA ──────────────────────────────────────────────────────────────────────────────────

test('sin decirlo expresamente, la ruta SIMULA', () => {
  assert.match(ruta, /const simulacion = body\.simulacion !== false/)
})

test('reprocesar exige admin o la llave del cron: no es una lectura', () => {
  assert.match(ruta, /auth\.role !== 'admin' && auth\.role !== 'director'/)
  assert.match(ruta, /Bearer \$\{process\.env\.CRON_SECRET\}/)
})

test('la ruta valida el rango antes de tocar la base', () => {
  assert.match(ruta, /Las fechas van en formato YYYY-MM-DD/)
  assert.match(ruta, /La fecha de inicio es posterior a la de fin/)
  assert.ok(ruta.indexOf('ISO_CORTA.test(desde)') < ruta.indexOf('await reprocesar('))
})

test('la respuesta dice si queda trabajo y cómo seguir', () => {
  assert.match(ruta, /quedaTrabajo: resumen\.cursor !== null/)
  assert.match(ruta, /siguiente: resumen\.cursor \?/)
})
