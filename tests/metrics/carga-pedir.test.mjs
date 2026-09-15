import assert from 'node:assert/strict'
import test from 'node:test'
import { datoFiable, faseCarga, puedePintarCero, RETARDO_LOADER_MS, UMBRAL_LENTO_MS } from '../../lib/ui/carga.ts'
import {
  esFalloVisible,
  fallo,
  pedir,
  TIMEOUT_POR_DEFECTO_MS,
  tipoPorExcepcion,
  tipoPorStatus,
} from '../../lib/ui/pedir.ts'

// =============================================================================================
// LAS FASES DEL LOADER
// =============================================================================================

test('una carga rápida no enseña loader: el parpadeo se lee como un fallo', () => {
  assert.equal(RETARDO_LOADER_MS, 300)
  assert.equal(faseCarga(true, 0), 'oculto')
  assert.equal(faseCarga(true, 299), 'oculto')
  assert.equal(faseCarga(true, 300), 'visible')
})

test('a partir del umbral lento se admite que algo va mal', () => {
  assert.equal(UMBRAL_LENTO_MS, 6000)
  assert.equal(faseCarga(true, 5999), 'visible')
  assert.equal(faseCarga(true, 6000), 'lento')
  assert.equal(faseCarga(true, 60_000), 'lento')
})

test('si no se está cargando no hay loader, por muchos ms que se le pasen', () => {
  assert.equal(faseCarga(false, 99_999), 'oculto')
})

test('los umbrales se pueden ajustar por pantalla', () => {
  assert.equal(faseCarga(true, 100, { retardoMs: 50 }), 'visible')
  assert.equal(faseCarga(true, 1000, { lentoMs: 500 }), 'lento')
})

// =============================================================================================
// UN 0 SOLO SE PINTA SI SE HA MEDIDO
// =============================================================================================

test('solo el cero medido se puede pintar como cero', () => {
  assert.equal(puedePintarCero('cero_real'), true)
  for (const e of [
    'cargando',
    'vacio',
    'sin_configurar',
    'desconectado',
    'sincronizacion_fallida',
    'sincronizando',
    'desactualizado',
    'sin_permiso',
    'error',
  ]) {
    assert.equal(puedePintarCero(e), false, `${e} no puede pintar un 0`)
  }
})

test('solo los estados medidos dan un dato fiable', () => {
  assert.equal(datoFiable('cero_real'), true)
  assert.equal(datoFiable('vacio'), true)
  assert.equal(datoFiable('desconectado'), false)
  assert.equal(datoFiable('sincronizacion_fallida'), false)
  assert.equal(datoFiable('error'), false)
})

// =============================================================================================
// LA CLASIFICACIÓN DEL FALLO. Un 403 no es "error de conexión" y reintentarlo no arregla nada.
// =============================================================================================

test('cada código HTTP se traduce a su tipo', () => {
  assert.equal(tipoPorStatus(401), 'auth')
  assert.equal(tipoPorStatus(403), 'permiso')
  assert.equal(tipoPorStatus(404), 'no_encontrado')
  assert.equal(tipoPorStatus(422), 'peticion')
  assert.equal(tipoPorStatus(500), 'servidor')
  assert.equal(tipoPorStatus(503), 'servidor')
})

test('solo es reintentable lo que reintentar puede arreglar', () => {
  for (const t of ['timeout', 'red', 'servidor', 'formato']) assert.equal(fallo(t).reintentable, true, t)
  for (const t of ['auth', 'permiso', 'no_encontrado', 'peticion', 'cancelado']) {
    assert.equal(fallo(t).reintentable, false, t)
  }
})

// Un AbortError es ambiguo: puede ser el timeout o que la persona haya cambiado de pantalla.
test('el abort se distingue entre timeout y navegación', () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
  assert.equal(tipoPorExcepcion(abort, true), 'timeout')
  assert.equal(tipoPorExcepcion(abort, false), 'cancelado')
  assert.equal(tipoPorExcepcion(new TypeError('failed to fetch'), false), 'red')
})

// Enseñar "error de red" porque alguien cambió de página es mentirle.
test('una cancelación no es un fallo que enseñar', () => {
  assert.equal(esFalloVisible(fallo('cancelado')), false)
  assert.equal(esFalloVisible(fallo('servidor')), true)
  assert.equal(esFalloVisible({ ok: true, data: 1, status: 200 }), false)
})

test('cada tipo trae un mensaje en español y sin jerga de red', () => {
  for (const t of ['timeout', 'red', 'auth', 'permiso', 'no_encontrado', 'servidor', 'peticion', 'formato']) {
    const f = fallo(t)
    assert.ok(f.mensaje.length > 10, t)
    assert.doesNotMatch(f.mensaje, /fetch|ECONN|undefined|NaN/i, t)
  }
})

// =============================================================================================
// `pedir` NUNCA LANZA. Es la garantía de la que depende que ningún `finally` se salte.
// =============================================================================================

const conFetch = async (impl, fn) => {
  const original = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

const respuesta = (body, { status = 200, ok = status < 400 } = {}) => ({
  ok,
  status,
  json: async () => JSON.parse(body),
  text: async () => body,
})

test('una respuesta correcta devuelve los datos', async () => {
  const r = await conFetch(
    async () => respuesta('{"a":1}'),
    () => pedir('/x')
  )
  assert.deepEqual(r, { ok: true, data: { a: 1 }, status: 200 })
})

// EL CASO QUE COLGABA LA PANTALLA: el fetch rechaza y nadie llega a setLoading(false).
test('un fetch que rechaza devuelve un fallo en vez de lanzar', async () => {
  const r = await conFetch(
    async () => {
      throw new TypeError('Failed to fetch')
    },
    () => pedir('/x')
  )
  assert.equal(r.ok, false)
  assert.equal(r.tipo, 'red')
  assert.equal(r.reintentable, true)
})

// EL OTRO CASO: 502 con el HTML de error del hosting en vez de JSON. `await r.json()` lanzaba.
test('un cuerpo que no es JSON no revienta: se marca como formato', async () => {
  const r = await conFetch(
    async () => respuesta('<html>502 Bad Gateway</html>'),
    () => pedir('/x')
  )
  assert.equal(r.ok, false)
  assert.equal(r.tipo, 'formato')
})

test('un error HTTP aprovecha el mensaje del servidor si lo trae', async () => {
  const r = await conFetch(
    async () => respuesta('{"error":"Solo dirección puede cambiar los objetivos"}', { status: 403 }),
    () => pedir('/x')
  )
  assert.equal(r.tipo, 'permiso')
  assert.equal(r.mensaje, 'Solo dirección puede cambiar los objetivos')
  assert.equal(r.status, 403)
})

test('un 403 sin cuerpo útil usa el mensaje de su tipo', async () => {
  const r = await conFetch(
    async () => respuesta('no-json', { status: 403 }),
    () => pedir('/x')
  )
  assert.match(r.mensaje, /permiso/i)
})

test('un 204 y un cuerpo vacío son éxito sin datos, no un fallo de formato', async () => {
  const sin = await conFetch(
    async () => respuesta('', { status: 204 }),
    () => pedir('/x')
  )
  assert.equal(sin.ok, true)
  const vacio = await conFetch(
    async () => respuesta('   '),
    () => pedir('/x')
  )
  assert.equal(vacio.ok, true)
})

// SIN TIMEOUT, una petición que nunca responde deja la pantalla cargando sin que haya ningún error.
test('una petición que nunca responde acaba en timeout', async () => {
  const r = await conFetch(
    (_url, init) =>
      new Promise((_res, rej) => {
        init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))
      }),
    () => pedir('/x', { timeoutMs: 20 })
  )
  assert.equal(r.ok, false)
  assert.equal(r.tipo, 'timeout')
})

test('el timeout por defecto está puesto y es finito', () => {
  assert.equal(TIMEOUT_POR_DEFECTO_MS, 15_000)
  assert.ok(Number.isFinite(TIMEOUT_POR_DEFECTO_MS))
})

// Cancelar al desmontar tiene que dar 'cancelado', no 'timeout': uno se enseña y el otro no.
test('cancelar desde fuera da cancelado, y no se enseña', async () => {
  const ac = new AbortController()
  const r = await conFetch(
    (_url, init) =>
      new Promise((_res, rej) => {
        init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' })))
        setTimeout(() => ac.abort(), 5)
      }),
    () => pedir('/x', { signal: ac.signal, timeoutMs: 5_000 })
  )
  assert.equal(r.tipo, 'cancelado')
  assert.equal(esFalloVisible(r), false)
})

test('con timeoutMs null no se pone techo, para descargas largas a propósito', async () => {
  const r = await conFetch(
    async () => respuesta('{"ok":true}'),
    () => pedir('/x', { timeoutMs: null })
  )
  assert.equal(r.ok, true)
})
