// Helpers de la bandeja de conversaciones (Setting AI): pura lógica de presentación, sin React.
// Cubre las decisiones que definen cómo se escanea la bandeja: iniciales del avatar (nunca
// inventadas desde teléfonos), tiempo relativo determinista (con `ahora` inyectado), agrupación
// por día para los separadores del chat y vista previa con el prefijo "Tú:" de los propios.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  alimentarVerificadas,
  claveDia,
  etiquetaDia,
  horaDe,
  inicialesDe,
  marcaVerificada,
  tiempoRelativo,
  ultimoMensaje,
  vistaPrevia,
} from '../lib/setting-ai/inbox.ts'

const AHORA = Date.parse('2026-09-29T18:00:00Z')

test('inicialesDe: nombre real → hasta 2 iniciales; teléfono/email sin nombre → null (nada inventado)', () => {
  assert.equal(inicialesDe('Ana García'), 'AG')
  assert.equal(inicialesDe('ana garcía'), 'AG')
  assert.equal(inicialesDe('Ana'), 'A')
  assert.equal(inicialesDe('María de los Ángeles Ruiz'), 'MD')
  // Un teléfono NO da iniciales: la UI pinta el icono del canal en su lugar.
  assert.equal(inicialesDe('+34 600 123 456'), null)
  assert.equal(inicialesDe('600123456'), null)
  // Un email toma la parte local (ana.perez@x.com → AP), pero si es solo dígitos, null.
  assert.equal(inicialesDe('ana.perez@example.com'), 'AP')
  assert.equal(inicialesDe('12345@example.com'), null)
  assert.equal(inicialesDe(''), null)
  assert.equal(inicialesDe(null), null)
  assert.equal(inicialesDe('   '), null)
})

test('tiempoRelativo: escalas es→determinista con `ahora` inyectado; fechas inválidas → null', () => {
  assert.equal(tiempoRelativo('2026-09-29T17:59:30Z', AHORA), 'ahora')
  assert.equal(tiempoRelativo('2026-09-29T17:45:00Z', AHORA), 'hace 15 min')
  assert.equal(tiempoRelativo('2026-09-29T14:00:00Z', AHORA), 'hace 4 h')
  assert.equal(tiempoRelativo('2026-09-27T18:00:00Z', AHORA), 'hace 2 d')
  assert.ok(tiempoRelativo('2026-05-10T12:00:00Z', AHORA).length > 0, 'fechas antiguas → fecha corta')
  assert.equal(tiempoRelativo(undefined, AHORA), null)
  assert.equal(tiempoRelativo('no-es-fecha', AHORA), null)
})

test('horaDe: HH:MM local; claveDia: estable por día local; etiquetaDia: Hoy/Ayer/fecha', () => {
  assert.equal(horaDe('2026-09-29T17:45:00Z'), horaDe('2026-09-29T17:45:00Z'))
  assert.ok(/^\d{2}:\d{2}$/.test(horaDe('2026-09-29T17:45:00Z')))
  assert.equal(horaDe(undefined), null)
  assert.equal(horaDe('basura'), null)

  const a = '2026-09-29T06:00:00Z'
  const b = '2026-09-29T21:00:00Z' // lejos de medianoche en cualquier TZ razonable: mismo día local
  // Mismo día local → misma clave aunque cambie la hora.
  assert.equal(claveDia(a), claveDia(b))
  assert.equal(claveDia(undefined), '')
  assert.equal(claveDia('basura'), '')

  assert.equal(etiquetaDia('2026-09-29T10:00:00Z', AHORA), 'Hoy')
  assert.equal(etiquetaDia('2026-09-28T12:00:00Z', AHORA), 'Ayer')
  assert.match(etiquetaDia('2026-05-10T12:00:00Z', AHORA), /10 may/)
  assert.equal(etiquetaDia(undefined, AHORA), null)
})

test('ultimoMensaje + vistaPrevia: el último del orden cronológico y prefijo "Tú:" en los propios', () => {
  const msgs = [
    { from: 'lead', text: 'Hola, vi el anuncio' },
    { from: 'agente', text: '¡Hola! Te cuento' },
  ]
  assert.equal(ultimoMensaje(msgs)?.from, 'agente')
  assert.equal(vistaPrevia(ultimoMensaje(msgs)), 'Tú: ¡Hola! Te cuento')
  assert.equal(vistaPrevia(ultimoMensaje([{ from: 'lead', text: 'Hola' }])), 'Hola')
  // Sin mensajes ni texto: estados honestos, nunca cadenas vacías que parezcan un bug.
  assert.equal(ultimoMensaje([]), null)
  assert.equal(vistaPrevia(null), 'Sin mensajes todavía')
  assert.equal(vistaPrevia({ from: 'agente' }), '—')
})

test('alimentarVerificadas: solo hechos (true) crean marca; lo nuevo gana y la otra plataforma no se toca', () => {
  const previas = alimentarVerificadas({}, 'ghl', [
    { conversationId: 'a', tieneAgenda: true, tieneVenta: false },
    { conversationId: 'b', tieneAgenda: null, tieneVenta: true },
    { conversationId: 'c', tieneAgenda: false, tieneVenta: false },
  ])
  assert.deepEqual(previas['ghl:a'], { agenda: true, venta: false })
  assert.deepEqual(previas['ghl:b'], { agenda: false, venta: true })
  // null (sin contacto vinculado) y false NO son marcas: no hay entrada.
  assert.equal(previas['ghl:c'], undefined)

  // La misma conversación llega re-verificada (contacto vinculado después, dato nuevo): gana lo
  // nuevo — pasar de venta a sin venta también se refleja.
  const actualizadas = alimentarVerificadas(previas, 'ghl', [
    { conversationId: 'b', tieneAgenda: true, tieneVenta: false },
  ])
  assert.deepEqual(actualizadas['ghl:b'], { agenda: true, venta: false })

  // La otra plataforma no se toca: claves por plataforma, nunca colisión por id compartido.
  const dos = alimentarVerificadas(previas, 'instagram', [{ conversationId: 'a', tieneVenta: true }])
  assert.deepEqual(dos['instagram:a'], { agenda: false, venta: true })
  assert.deepEqual(dos['ghl:a'], { agenda: true, venta: false })
})

test('marcaVerificada: entrada sin hecho → null; con cita o venta → la verificación', () => {
  assert.equal(marcaVerificada(undefined), null)
  assert.equal(marcaVerificada(null), null)
  assert.equal(marcaVerificada({ agenda: false, venta: false }), null)
  assert.deepEqual(marcaVerificada({ agenda: true, venta: false }), { agenda: true, venta: false })
  assert.deepEqual(marcaVerificada({ agenda: false, venta: true }), { agenda: false, venta: true })
})
