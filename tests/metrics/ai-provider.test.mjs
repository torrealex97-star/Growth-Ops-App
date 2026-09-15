import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEEPSEEK_DEFAULT_MODEL,
  DEEPSEEK_MODELOS_PREFERIDOS,
  deepseekModel,
  selectEngine,
} from '../../lib/ai/provider.ts'
import { agentProvider } from '../../lib/ai/agent/gateway.ts'

// Conectar DeepSeek en Integraciones tiene que CAMBIAR quién atiende las peticiones. Antes las
// funciones de IA llamaban a Anthropic directamente, así que la integración daba verde y no movía
// un dato: una integración que solo existe en la pantalla.
test('con clave de DeepSeek, el motor es DeepSeek', () => {
  assert.equal(selectEngine({ DEEPSEEK_API_KEY: 'sk-abc', ANTHROPIC_API_KEY: 'sk-ant' }), 'deepseek')
})

test('el agente usa el endpoint Anthropic-compatible de DeepSeek con el modelo de la subcuenta', () => {
  const provider = agentProvider({ DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_MODEL: 'deepseek-flash' })
  assert.equal(provider.engine, 'deepseek')
  assert.equal(provider.model, 'deepseek-flash')
  assert.equal(provider.client.baseURL, 'https://api.deepseek.com/anthropic')
})

test('sin ningún motor configurado el agente falla antes de enviar datos', () => {
  assert.throws(() => agentProvider({}), /Configura una clave de DeepSeek o Anthropic/)
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

// Este test fijaba que el catálogo nombrara el modelo por defecto. Ese contrato CAMBIÓ a propósito:
// el modelo ya no se escribe a mano ni se promete uno concreto en la ayuda, porque un nombre fijo
// deja la IA muerta en cuanto el proveedor lo retira. Ahora el catálogo manda a buscar los modelos
// reales de la cuenta, y lo que se comprueba es que el valor por defecto esté entre los preferidos
// —que a su vez se cruzan con lo que la API dice tener antes de usarse.
test('el catálogo manda a buscar modelos reales en vez de prometer uno concreto', async () => {
  const catalog = await import('../../lib/integrations-catalog.ts')
  // Y DeepSeek dejó de tener tarjeta propia: se configura dentro del módulo de IA, con Anthropic y
  // Groq, porque es un motor más de los que la plataforma puede usar.
  const ia = catalog.INTEGRATION_GROUPS.find((g) => g.id === 'ai')
  assert.ok(ia, 'no existe el grupo de IA en el catálogo')
  assert.ok(
    !catalog.INTEGRATION_GROUPS.some((g) => g.id === 'deepseek'),
    'DeepSeek no debe volver a ser una integración aparte'
  )
  const modelField = ia.fields.find((f) => f.key === 'DEEPSEEK_MODEL')
  assert.ok(modelField, 'el modelo de DeepSeek debe estar en el módulo de IA')
  assert.match(modelField.help, /Buscar modelos/)
  assert.ok(
    DEEPSEEK_MODELOS_PREFERIDOS.includes(DEEPSEEK_DEFAULT_MODEL),
    'el último recurso debe ser uno de los modelos preferidos'
  )
})
