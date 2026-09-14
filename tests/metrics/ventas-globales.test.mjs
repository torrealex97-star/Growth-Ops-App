import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildSalesOverview, isCancelled } from '../../lib/unit-economics.ts'

const AHORA = new Date('2026-09-14T12:00:00Z')
const cita = (status, dias, contacto) => ({
  contact_id: contacto,
  status,
  appointment_datetime: new Date(AHORA.getTime() + dias * 86400000).toISOString(),
  pipe_value: 100,
})

test('los estados cancelados se reconocen en INGLÉS, que es como los escribe Calendly', () => {
  // Buscar 'cancelada' devolvía CERO canceladas sobre 213 reales, y con ello un show-up del 100 %.
  assert.equal(isCancelled('cancelled'), true)
  assert.equal(isCancelled('canceled'), true)
  assert.equal(isCancelled('CANCELLED'), true)
  assert.equal(isCancelled('cancelada'), true)
  assert.equal(isCancelled('scheduled'), false)
  assert.equal(isCancelled('confirmed'), false)
  assert.equal(isCancelled(null), false)
})

test('una cita FUTURA no cuenta como show todavía', () => {
  const r = buildSalesOverview([cita('scheduled', -1, 'c1'), cita('confirmed', +5, 'c2')], [], [], 'todos', AHORA)
  assert.equal(r.agendas, 2)
  assert.equal(r.shows, 1, 'solo la que ya pasó')
})

test('las métricas globales cuentan TODO, no solo lo atribuido a anuncios', () => {
  // Es el bug que se veía en pantalla: 559 agendas en la base y "Sales calls booked: 0", porque el
  // KPI exigía que el contacto tuviera campaña y NINGUNO la tiene.
  const citas = [cita('scheduled', -1, 'con_ads'), cita('scheduled', -2, 'organico')]
  const contactos = [
    { id: 'con_ads', campaign_id: 'camp1' },
    { id: 'organico', campaign_id: null },
  ]
  const todos = buildSalesOverview(citas, [], contactos, 'todos', AHORA)
  assert.equal(todos.agendas, 2)
  assert.equal(todos.shows, 2)
})

test('el origen es un filtro, y reparte sin perder ni duplicar', () => {
  const citas = [cita('scheduled', -1, 'con_ads'), cita('scheduled', -2, 'organico'), cita('scheduled', -3, null)]
  const contactos = [
    { id: 'con_ads', campaign_id: 'camp1' },
    { id: 'organico', campaign_id: null },
  ]
  const ads = buildSalesOverview(citas, [], contactos, 'ads', AHORA)
  const org = buildSalesOverview(citas, [], contactos, 'organico', AHORA)
  assert.equal(ads.agendas, 1)
  assert.equal(org.agendas, 2, 'sin contacto cuenta como no atribuido, no se pierde')
  assert.equal(ads.agendas + org.agendas, 3, 'las partes suman el total')
})

test('con los números REALES de producción da lo que se espera', () => {
  // 559 citas: 213 cancelled, 272 scheduled (260 pasadas), 71 confirmed (66 pasadas), 3 show.
  const citas = [
    ...Array.from({ length: 213 }, (_, i) => cita('cancelled', -1, `x${i}`)),
    ...Array.from({ length: 260 }, (_, i) => cita('scheduled', -1, `a${i}`)),
    ...Array.from({ length: 12 }, (_, i) => cita('scheduled', +3, `b${i}`)),
    ...Array.from({ length: 66 }, (_, i) => cita('confirmed', -1, `c${i}`)),
    ...Array.from({ length: 5 }, (_, i) => cita('confirmed', +2, `d${i}`)),
    ...Array.from({ length: 3 }, (_, i) => cita('show', -1, `e${i}`)),
  ]
  const r = buildSalesOverview(citas, [], [], 'todos', AHORA)
  assert.equal(r.agendas, 559)
  assert.equal(r.canceladas, 213)
  // 260 + 66 + 3 ya pasadas y no canceladas. Las 17 futuras no cuentan todavía.
  assert.equal(r.shows, 329)
  assert.equal(Math.round(r.tasaAsistencia), 59)
})

test('la pantalla separa lo global de lo atribuido a anuncios', () => {
  const page = readFileSync(new URL('../../app/[tenant]/unit-economics/page.tsx', import.meta.url), 'utf8')
  assert.match(page, /Ventas y agendas/)
  assert.match(page, /Todos los orígenes/)
  assert.match(
    page,
    /buildSalesOverview\(agendasVisibles, ventasVisibles, contacts, origen, new Date\(\), fathomVisible\)/
  )
  // Las llamadas de Fathom sin cita se leen de la cola de revisión, no de una tabla inventada.
  assert.match(page, /from\('fathom_match_review'\)/)
  assert.match(page, /\.eq\('status', 'pendiente'\)/)
  // El embudo de marketing sigue siendo el atribuido, y ahora lo dice.
  // Se normalizan los espacios: el ancho de línea lo decide prettier, no el test.
  const texto = page.replace(/\s+/g, ' ')
  assert.match(texto, /solo lo que viene de anuncios/)
})

test('las llamadas de Fathom sin cita cuentan como llamadas reales', () => {
  // Están grabadas y transcritas: ocurrieron. Que no casaran con una cita de Calendly no las borra.
  const fathom = [{ meeting_started_at: '2026-09-01T10:00:00Z' }, { meeting_started_at: '2026-09-02T10:00:00Z' }]
  const r = buildSalesOverview([cita('scheduled', -1, 'c1')], [], [], 'todos', AHORA, fathom)
  assert.equal(r.shows, 3, '1 cita pasada + 2 llamadas de Fathom')
  assert.equal(r.llamadasSinCita, 2, 'se ven aparte, no escondidas dentro del total')
})

test('no se les inventa un origen: solo suman cuando se miran todos', () => {
  // Sin contacto no hay campaña que mirar, así que meterlas en "solo anuncios" sería atribuirles una
  // procedencia que no tienen.
  const fathom = [{ meeting_started_at: '2026-09-01T10:00:00Z' }]
  const contactos = [{ id: 'c1', campaign_id: 'camp1' }]
  const ads = buildSalesOverview([cita('scheduled', -1, 'c1')], [], contactos, 'ads', AHORA, fathom)
  assert.equal(ads.llamadasSinCita, 0)
  assert.equal(ads.shows, 1, 'solo la cita atribuida')
})

test('la asistencia no puede pasar del 100 % por sumar llamadas no agendadas', () => {
  // El numerador de asistencia mide lo AGENDADO que se presentó; las llamadas sin cita nunca se
  // agendaron, así que entran en shows pero no en esa tasa.
  const fathom = Array.from({ length: 50 }, () => ({ meeting_started_at: '2026-09-01T10:00:00Z' }))
  const r = buildSalesOverview([cita('scheduled', -1, 'c1')], [], [], 'todos', AHORA, fathom)
  assert.equal(r.shows, 51)
  assert.equal(r.tasaAsistencia, 100, 'una cita agendada, una presentada')
  assert.ok(r.tasaAsistencia <= 100)
})

test('con los datos reales: 329 shows de citas + 177 de Fathom', () => {
  const citas = [
    ...Array.from({ length: 213 }, (_, i) => cita('cancelled', -1, `x${i}`)),
    ...Array.from({ length: 329 }, (_, i) => cita('scheduled', -1, `a${i}`)),
    ...Array.from({ length: 17 }, (_, i) => cita('scheduled', +3, `b${i}`)),
  ]
  const fathom = Array.from({ length: 177 }, () => ({ meeting_started_at: '2026-09-01T10:00:00Z' }))
  const r = buildSalesOverview(citas, [], [], 'todos', AHORA, fathom)
  assert.equal(r.agendas, 559)
  assert.equal(r.shows, 506, '329 citas presentadas + 177 llamadas grabadas sin cita')
  assert.equal(r.llamadasSinCita, 177)
})
