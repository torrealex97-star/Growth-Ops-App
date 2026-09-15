import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MANUAL_STEPS,
  NAME_MAX,
  PROVISION_STEPS,
  createTenantIdentity,
  initialSettings,
  validateTenantInput,
} from '../../lib/tenants/blueprint.ts'

test('la URL de una subcuenta nueva usa exactamente su UUID interno', () => {
  const first = createTenantIdentity()
  const second = createTenantIdentity()
  assert.equal(first.slug, first.id)
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(first.id, second.id)
})

test('el nombre es obligatorio pero no determina la identidad ni la URL', () => {
  assert.ok('error' in validateTenantInput({}))
  assert.ok('error' in validateTenantInput({ name: '   ' }))
  assert.ok('error' in validateTenantInput({ name: 'x'.repeat(NAME_MAX + 1) }))

  const r = validateTenantInput({ name: '  Mi Academia  ' })
  assert.ok('input' in r)
  assert.equal(r.input.name, 'Mi Academia')
  assert.equal('slug' in r.input, false, 'el nombre o el cliente no deben poder elegir el slug')
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
