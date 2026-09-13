import assert from 'node:assert/strict'
import test from 'node:test'
import { DEEPSEEK_DEFAULT_MODEL, deepseekModel, selectEngine } from '../../lib/ai/provider.ts'

// Conectar DeepSeek en Integraciones tiene que CAMBIAR quién atiende las peticiones. Antes las
// funciones de IA llamaban a Anthropic directamente, así que la integración daba verde y no movía
// un dato: una integración que solo existe en la pantalla.
test('con clave de DeepSeek, el motor es DeepSeek', () => {
  assert.equal(selectEngine({ DEEPSEEK_API_KEY: 'sk-abc', ANTHROPIC_API_KEY: 'sk-ant' }), 'deepseek')
})

// Y no se activa solo: sin clave, todo sigue exactamente como estaba. Cambiar el motor de una
// subcuenta que no lo ha pedido es cambiarle el resultado de sus análisis sin avisar.
test('sin clave de DeepSeek, no cambia nada', () => {
  assert.equal(selectEngine({ ANTHROPIC_API_KEY: 'sk-ant' }), 'anthropic')
  assert.equal(selectEngine({}), 'anthropic')
  // Una clave en blanco o a espacios es "no configurada", no una clave.
  assert.equal(selectEngine({ DEEPSEEK_API_KEY: '   ' }), 'anthropic')
  assert.equal(selectEngine({ DEEPSEEK_API_KEY: '' }), 'anthropic')
})

test('el modelo sale de la configuración de la subcuenta, con un defecto declarado', () => {
  assert.equal(deepseekModel({}), DEEPSEEK_DEFAULT_MODEL)
  assert.equal(deepseekModel({ DEEPSEEK_MODEL: '  ' }), DEEPSEEK_DEFAULT_MODEL)
  assert.equal(deepseekModel({ DEEPSEEK_MODEL: 'deepseek-reasoner' }), 'deepseek-reasoner')
})

// El mismo defecto que declara el catálogo de integraciones: si se separan, la comprobación de
// conexión valida un modelo y las peticiones reales usan otro.
test('el modelo por defecto coincide con el que declara el catálogo', async () => {
  const catalog = await import('../../lib/integrations-catalog.ts')
  const deepseek = catalog.INTEGRATION_GROUPS.find((g) => g.id === 'deepseek')
  assert.ok(deepseek, 'no existe el grupo deepseek en el catálogo')
  const modelField = deepseek.fields.find((f) => f.key === 'DEEPSEEK_MODEL')
  assert.ok(
    modelField.help.includes(DEEPSEEK_DEFAULT_MODEL) || modelField.placeholder?.includes(DEEPSEEK_DEFAULT_MODEL),
    `el catálogo no menciona ${DEEPSEEK_DEFAULT_MODEL} como valor por defecto`
  )
})
