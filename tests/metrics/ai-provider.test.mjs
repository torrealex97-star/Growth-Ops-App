import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_MODELOS_PREFERIDOS,
  deepseekModel,
  selectEngine,
} from '../../lib/ai/provider.ts'

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
// Este test fijaba que el catálogo nombrara el modelo por defecto. Ese contrato CAMBIÓ a propósito:
// el modelo ya no se escribe a mano ni se promete uno concreto en la ayuda, porque un nombre fijo
// deja la IA muerta en cuanto el proveedor lo retira. Ahora el catálogo manda a buscar los modelos
// reales de la cuenta, y lo que se comprueba es que el valor por defecto esté entre los preferidos
// —que a su vez se cruzan con lo que la API dice tener antes de usarse.
test('el catálogo manda a buscar modelos reales en vez de prometer uno concreto', async () => {
  const catalog = await import('../../lib/integrations-catalog.ts')
  const deepseek = catalog.INTEGRATION_GROUPS.find((g) => g.id === 'deepseek')
  assert.ok(deepseek, 'no existe el grupo deepseek en el catálogo')
  const modelField = deepseek.fields.find((f) => f.key === 'DEEPSEEK_MODEL')
  assert.match(modelField.help, /Buscar modelos/)
  assert.ok(
    DEEPSEEK_MODELOS_PREFERIDOS.includes(DEEPSEEK_DEFAULT_MODEL),
    'el último recurso debe ser uno de los modelos preferidos'
  )
})
