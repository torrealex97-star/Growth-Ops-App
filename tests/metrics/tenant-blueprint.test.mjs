import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MANUAL_STEPS,
  NAME_MAX,
  PROVISION_STEPS,
  RESERVED_SLUGS,
  SLUG_MAX,
  SLUG_MIN,
  initialSettings,
  normalizeSlug,
  validateTenantInput,
} from '../../lib/tenants/blueprint.ts'

test('el slug se deriva del nombre sin dejar nada que rompa una URL', () => {
  assert.equal(normalizeSlug('Women Digital Closer'), 'women-digital-closer')
  assert.equal(normalizeSlug('  Formación  Élite  '), 'formacion-elite')
  assert.equal(normalizeSlug('[tenant]!! 2026'), 'ia-winners-2026')
  assert.equal(normalizeSlug('---a---b---'), 'a-b')
  assert.equal(normalizeSlug('###'), '')
  // Idempotente: normalizar un slug ya normalizado no lo cambia.
  assert.equal(normalizeSlug(normalizeSlug('Hayat’s Chocolate Factory')), normalizeSlug('Hayat’s Chocolate Factory'))
})

// El primer segmento de la URL ES la subcuenta, así que una subcuenta llamada 'api' o 'embed' taparía
// rutas reales de la aplicación. Y no daría ningún error al crearla: simplemente dejaría de funcionar
// una parte del producto para todo el mundo.
test('no se puede crear una subcuenta que tape una ruta de la aplicación', () => {
  // Cada reservado tiene que estar en su forma normalizada: '_next' o 'favicon.ico' serían entradas
  // muertas, porque el guion bajo y el punto desaparecen al normalizar y jamás saldrían de
  // `normalizeSlug`. Este bucle encontró exactamente ese fallo.
  for (const reservado of RESERVED_SLUGS) {
    assert.equal(normalizeSlug(reservado), reservado, `el reservado "${reservado}" nunca podría coincidir`)
  }
  for (const reservado of ['api', 'embed', 'firmar', 'firmar-alumno', 'next', 'platform', 'login']) {
    assert.ok(RESERVED_SLUGS.includes(reservado), `${reservado} debería estar reservado`)
    const r = validateTenantInput({ name: reservado })
    assert.ok('error' in r, `se ha permitido el slug reservado ${reservado}`)
  }
})

test('el nombre es obligatorio y el slug se normaliza siempre', () => {
  assert.ok('error' in validateTenantInput({}))
  assert.ok('error' in validateTenantInput({ name: '   ' }))
  assert.ok('error' in validateTenantInput({ name: 'x'.repeat(NAME_MAX + 1) }))
  // Demasiado corto tras normalizar: 'A!' se queda en 'a'.
  assert.ok('error' in validateTenantInput({ name: 'A!' }))
  assert.ok('error' in validateTenantInput({ name: 'ok', slug: 'x'.repeat(SLUG_MAX + 1) }))

  const r = validateTenantInput({ name: '  Mi Academia  ', slug: 'Mi ACADEMIA' })
  assert.ok('input' in r)
  assert.equal(r.input.slug, 'mi-academia', 'un slug con mayúsculas o espacios rompería sus URLs para siempre')
  assert.equal(r.input.name, 'Mi Academia')
  assert.ok(r.input.slug.length >= SLUG_MIN)
})

test('el acento de marca solo puede ser uno de los soportados', () => {
  const rosa = validateTenantInput({ name: 'WDC', accent: 'pink' })
  assert.ok('input' in rosa)
  assert.equal(rosa.input.accent, 'pink')
  // Cualquier otra cosa cae al de por defecto en vez de guardarse tal cual: un acento inventado
  // dejaría la subcuenta sin estilos sin decir por qué.
  const raro = validateTenantInput({ name: 'WDC', accent: 'fucsia-neon' })
  assert.ok('input' in raro)
  assert.equal(raro.input.accent, 'brand')
})

test('los ajustes iniciales son solo la marca: nada inventado', () => {
  const { input } = validateTenantInput({ name: 'Top Dentist', accent: 'pink' })
  const settings = initialSettings(input)
  assert.deepEqual(settings, { branding: { name: 'Top Dentist', accent: 'pink' } })
  assert.deepEqual(Object.keys(settings), ['branding'], 'los ajustes iniciales traen algo más que la marca')
})

// Un "pendiente" sin motivo se lee como una tarea olvidada. Con motivo se lee como una decisión, y
// aquí la decisión es concreta: no se crean productos ni planes de ejemplo porque de esas tablas
// salen la facturación y las comisiones.
test('cada paso manual dice por qué no se automatiza', () => {
  assert.ok(MANUAL_STEPS.length > 0)
  for (const step of MANUAL_STEPS) {
    assert.ok(step.reason && step.reason.length > 20, `el paso ${step.id} no explica por qué es manual`)
  }
  const productos = PROVISION_STEPS.find((s) => s.id === 'productos')
  assert.equal(productos.automatic, false, 'crear productos de ejemplo sería inventar datos financieros')
  assert.match(productos.reason, /NOT NULL|inventad/i)
  // Y los automáticos son exactamente los tres que sí se pueden saber al crear la subcuenta.
  assert.deepEqual(
    PROVISION_STEPS.filter((s) => s.automatic).map((s) => s.id),
    ['tenant', 'membership', 'audit']
  )
})
