import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EVENT_MAP_KEY,
  MAX_NAMES_PER_STAGE,
  mappableStages,
  namesFor,
  parseEventMap,
  serializeEventMap,
  stageKey,
  validateEventMap,
} from '../../lib/funnels/event-map.ts'

// La clave incluye la familia porque 'visitas' existe en el funnel de VSL y en el de webinar, y no
// son la misma página. Si la clave fuera solo el id de etapa, mapear la landing del VSL mapearía
// también la página de registro del webinar, en silencio y con números plausibles.
test('las etapas homónimas de dos familias no comparten mapeo', () => {
  assert.notEqual(stageKey('vsl', 'visitas'), stageKey('webinar', 'visitas'))
  const map = validateEventMap({ 'vsl.visitas': ['landing_view'] })
  assert.ok('map' in map)
  assert.deepEqual(namesFor(map.map, 'vsl', 'visitas'), ['landing_view'])
  assert.deepEqual(namesFor(map.map, 'webinar', 'visitas'), [], 'el webinar heredó el mapeo del VSL')
})

test('las etapas mapeables son exactamente las de fuente de tracking propio', () => {
  const keys = mappableStages().map((s) => s.key)
  assert.ok(keys.includes('vsl.visitas'), 'falta la etapa de visitas del VSL')
  assert.ok(keys.includes('webinar.visitas'), 'falta la etapa de visitas del webinar')
  // Ninguna etapa de CRM, Meta o GA4 se mapea aquí: esas fuentes sí tienen columnas determinadas.
  assert.ok(
    !keys.some((k) => k.endsWith('.cierres') || k.endsWith('.impresiones') || k.endsWith('.sesiones')),
    'se han colado etapas que no salen de canonical_events'
  )
  for (const stage of mappableStages()) {
    assert.ok(stage.label && stage.familyLabel, 'una etapa mapeable sin etiqueta legible')
  }
})

// Lo guardado puede venir de una versión anterior, de una etapa que ya no existe, o ser basura. En
// ese caso la etapa tiene que salir 'no_configurada' — nunca reventar el cálculo del funnel entero.
test('un mapeo corrupto no rompe el funnel: se ignora', () => {
  assert.deepEqual(parseEventMap(null), {})
  assert.deepEqual(parseEventMap(''), {})
  assert.deepEqual(parseEventMap('esto no es json'), {})
  assert.deepEqual(parseEventMap('[1,2,3]'), {})
  assert.deepEqual(parseEventMap('{"etapa.que.no.existe":["x"]}'), {})
  assert.deepEqual(parseEventMap('{"vsl.visitas":"no es lista"}'), {})
  // Lo válido de un objeto medio corrupto sí se conserva: perderlo dejaría un funnel sin mapear
  // porque otra clave estaba mal.
  assert.deepEqual(parseEventMap('{"vsl.visitas":["ok"],"inventada":["x"]}'), { 'vsl.visitas': ['ok'] })
})

test('los nombres se limpian sin cambiar su significado', () => {
  const { map } = validateEventMap({ 'vsl.visitas': ['  landing_view  ', 'landing_view', '', 'PageView'] })
  // Se recorta y se deduplica, pero NO se pasa a minúsculas: en base 'PageView' y 'pageview' son dos
  // eventos distintos y fundirlos sería otra suposición.
  assert.deepEqual(map['vsl.visitas'], ['landing_view', 'PageView'])
})

test('una etapa sin nombres se borra en vez de guardarse vacía', () => {
  const { map } = validateEventMap({ 'vsl.visitas': [] })
  assert.deepEqual(map, {}, 'desmapear y no haber mapeado nunca tienen que ser el mismo estado')
})

test('se rechaza lo que no se puede guardar, y sin guardar nada a medias', () => {
  assert.ok('error' in validateEventMap(null))
  assert.ok('error' in validateEventMap(['vsl.visitas']))
  assert.ok('error' in validateEventMap({ 'etapa.inexistente': ['x'] }))
  assert.ok('error' in validateEventMap({ 'vsl.visitas': [42] }))
  assert.ok('error' in validateEventMap({ 'vsl.visitas': ['x'.repeat(500)] }))
  assert.ok(
    'error' in validateEventMap({ 'vsl.visitas': Array.from({ length: MAX_NAMES_PER_STAGE + 1 }, (_, i) => `e${i}`) })
  )
  // Un error en UNA etapa no guarda las otras: media configuración haría contar al funnel cosas que
  // el usuario no eligió.
  const mixto = validateEventMap({ 'vsl.visitas': ['bueno'], 'etapa.inexistente': ['malo'] })
  assert.ok('error' in mixto)
  assert.ok(!('map' in mixto))
})

test('guardar dos veces el mismo mapeo produce el mismo texto', () => {
  const a = serializeEventMap({ 'webinar.visitas': ['b'], 'vsl.visitas': ['a'] })
  const b = serializeEventMap({ 'vsl.visitas': ['a'], 'webinar.visitas': ['b'] })
  assert.equal(a, b, 'el orden de las claves cambiaría el valor guardado sin que nada haya cambiado')
  assert.deepEqual(parseEventMap(a), { 'vsl.visitas': ['a'], 'webinar.visitas': ['b'] })
})

test('la clave de configuración es estable', () => {
  // Si esta clave cambia, los mapeos ya guardados dejan de leerse y las etapas vuelven a salir sin
  // configurar sin que nadie haya tocado nada.
  assert.equal(EVENT_MAP_KEY, 'FUNNEL_EVENT_MAP')
})
