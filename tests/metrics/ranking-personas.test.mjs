import assert from 'node:assert/strict'
import test from 'node:test'
import { teamRanking, setterAgendaStats } from '../../lib/analytics.ts'
import { agendasPorPersona, ventasPorColaborador } from '../../lib/analytics-agendas.ts'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// tests/metrics/* → dos niveles hasta la raíz del proyecto.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// ─── REGRESIÓN: el rol no puede borrar a quien trabaja ──────────────────────
// Caso WDC real: Claudia cierra con rol 'admin'; el filtro por rol la excluía de
// "Closers" con el 100% de las ventas del negocio. La venta ya lleva a su closer
// asignado: la agregación cuenta a quien consta en el dato, no a quien tiene el rol.

const claudia = { id: 'u-claudia', full_name: 'Claudia Martinez', role: 'admin' }
const diana = { id: 'u-diana', full_name: 'Diana MPF', role: 'setter' }

const venta = (id, { closer = null, setter = null, gross = 5000, status = 'active' } = {}) => ({
  id,
  gross_amount: gross,
  status,
  sale_date: '2026-09-10',
  closer_id: closer,
  setter_id: setter,
  contact_id: null,
})
const cobro = (sale_id, gross = 2500) => ({
  sale_id,
  gross_amount: gross,
  status: 'collected',
  collected_at: '2026-09-11',
})
const agenda = (id, { closer = null, setter = null, status = 'scheduled', contact = null } = {}) => ({
  id,
  appointment_datetime: '2026-09-10T10:00:00Z',
  status,
  setter_id: setter,
  closer_id: closer,
  contact_id: contact,
})

test('el ranking cuenta a quien cierra aunque su rol sea admin (caso Claudia)', () => {
  const ventas = [venta('s1', { closer: claudia.id, gross: 8000 }), venta('s2', { closer: claudia.id, gross: 7500 })]
  const ranking = teamRanking(ventas, [cobro('s1'), cobro('s2')], [claudia, diana], 'closer')
  assert.equal(ranking.length, 1)
  assert.equal(ranking[0].name, 'Claudia Martinez')
  assert.equal(ranking[0].sales, 2)
  assert.equal(ranking[0].gross, 15500)
  assert.equal(ranking[0].cash, 5000)
})

test('setterAgendaStats ya no filtra por rol: cuenta la agenda de quien consta', () => {
  const rows = setterAgendaStats(
    [agenda('a1', { setter: claudia.id, status: 'show' }), agenda('a2', { setter: diana.id })],
    [claudia, diana]
  )
  assert.equal(rows.length, 2)
  const d = rows.find((r) => r.name === 'Diana MPF')
  assert.equal(d.total, 1)
})

// ─── Agendas por persona ─────────────────────────────────────────────────────

const nombres = new Map([
  ['u-claudia', 'Claudia Martinez'],
  ['u-diana', 'Diana MPF'],
  ['colab-noelia', 'Noelia Zazo'],
])

test('agendasPorPersona closer: totales, shows y show rate por closer_id', () => {
  const rows = agendasPorPersona(
    [
      agenda('a1', { closer: 'u-claudia', status: 'show' }),
      agenda('a2', { closer: 'u-claudia' }),
      agenda('a3', { closer: 'u-claudia', status: 'no_show' }),
      agenda('a4', { closer: 'u-diana', status: 'show' }),
    ],
    { persona: 'closer', nameOf: nombres, collaboratorOf: new Map() }
  )
  const c = rows.find((r) => r.userId === 'u-claudia')
  assert.equal(c.total, 3)
  assert.equal(c.shows, 1)
  assert.equal(c.noShows, 1)
  // El ratio va sobre las RESUELTAS (1 de 2), no sobre las 3 agendas. La tercera no tiene estado:
  // nadie faltó a ella, simplemente nadie la ha marcado. Este test afirmaba lo contrario (1/3) y
  // por eso el fallo llegó a producción: una persona con 68 agendas, 34 asistidas y CERO no-shows
  // aparecía con un 50 % de asistencia.
  assert.equal(c.showRate, 50)
  assert.equal(c.sinResolver, 1)
})

test('sin ninguna cita resuelta no hay ratio: null, no 0 %', () => {
  // Un 0 % aquí es un problema inventado — la misma regla que aplica la definición canónica.
  const rows = agendasPorPersona([agenda('a1', { closer: 'u-claudia' }), agenda('a2', { closer: 'u-claudia' })], {
    persona: 'closer',
    nameOf: nombres,
    collaboratorOf: new Map(),
  })
  const c = rows.find((r) => r.userId === 'u-claudia')
  assert.equal(c.showRate, null)
  assert.equal(c.sinResolver, 2)
})

test('una cita cancelada no cuenta como "sin marcar" ni hunde el ratio', () => {
  // Nadie dejó de presentarse a algo que se canceló: ni numerador, ni denominador, ni pendiente.
  const rows = agendasPorPersona(
    [agenda('a1', { closer: 'u-claudia', status: 'show' }), agenda('a2', { closer: 'u-claudia', status: 'cancelled' })],
    { persona: 'closer', nameOf: nombres, collaboratorOf: new Map() }
  )
  const c = rows.find((r) => r.userId === 'u-claudia')
  assert.equal(c.showRate, 100)
  assert.equal(c.sinResolver, 0)
})

test('completed también es asistir', () => {
  // `status === 'show'` dejaba fuera a quien cierra la llamada marcándola completada, y esa cita
  // caía al saco de "sin marcar" hundiendo su ratio.
  const rows = agendasPorPersona([agenda('a1', { closer: 'u-claudia', status: 'completed' })], {
    persona: 'closer',
    nameOf: nombres,
    collaboratorOf: new Map(),
  })
  assert.equal(rows[0].shows, 1)
  assert.equal(rows[0].showRate, 100)
})

test('agendasPorPersona sin asignar no inventa fila', () => {
  const rows = agendasPorPersona([agenda('a1'), agenda('a2', { setter: 'u-diana' })], {
    persona: 'setter',
    nameOf: nombres,
    collaboratorOf: new Map(),
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'Diana MPF')
})

test('agendasPorPersona colaborador: resuelve vía contacto→colaborador', () => {
  const colabOf = new Map([
    ['c-1', 'colab-noelia'],
    ['c-2', 'colab-noelia'],
  ])
  const rows = agendasPorPersona(
    [
      agenda('a1', { contact: 'c-1' }),
      agenda('a2', { contact: 'c-2', status: 'show' }),
      agenda('a3', { contact: 'c-9' }),
    ],
    { persona: 'collaborator', nameOf: nombres, collaboratorOf: colabOf }
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'Noelia Zazo')
  assert.equal(rows[0].total, 2)
  assert.equal(rows[0].shows, 1)
})

// ─── Ventas por colaborador ──────────────────────────────────────────────────

test('ventasPorColaborador: facturación y cobros de los contactos atribuidos', () => {
  const colabOf = new Map([['c-1', 'colab-noelia']])
  const ventas = [
    {
      id: 's1',
      gross_amount: 8000,
      status: 'active',
      sale_date: '2026-09-10',
      closer_id: null,
      setter_id: null,
      contact_id: 'c-1',
    },
    {
      id: 's2',
      gross_amount: 3000,
      status: 'refunded',
      sale_date: '2026-09-11',
      closer_id: null,
      setter_id: null,
      contact_id: 'c-1',
    },
    {
      id: 's3',
      gross_amount: 5000,
      status: 'active',
      sale_date: '2026-09-12',
      closer_id: null,
      setter_id: null,
      contact_id: 'c-7',
    },
  ]
  const rows = ventasPorColaborador(ventas, [cobro('s1', 4000)], { nameOf: nombres, collaboratorOf: colabOf })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].sales, 1)
  assert.equal(rows[0].gross, 8000)
  assert.equal(rows[0].cash, 4000)
})

// ─── El dashboard muestra los tres bloques ───────────────────────────────────

test('el dashboard carga colaboradores y pinta agendas por persona con tabs', () => {
  const page = read('app/[tenant]/dashboard/page.tsx')
  assert.match(page, /agendasPorPersona\(/)
  assert.match(page, /ventasPorColaborador\(/)
  assert.match(page, /collaborator_id/, 'las atribuciones traen el colaborador')
  assert.match(page, /collaborator_profiles/, 'trae los perfiles para los nombres')
  const ranking = read('components/os/TeamRanking.tsx')
  assert.match(ranking, /colaboradores/)
})
