import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// Una integración que se conecta y no mueve un dato es una integración que solo existe en la
// pantalla. Estas funciones son las que tienen que pasar por el motor configurable para que
// conectar DeepSeek signifique algo.
const POR_EL_MOTOR = [
  ['lib/ai/claude.ts', 'analyzeCall'],
  ['lib/ai/claude.ts', 'analyzeReel'],
  ['lib/ai/claude.ts', 'generateScript'],
  ['lib/ai/claude.ts', 'contractVariablesFromText'],
  ['app/api/[tenant]/evergreen/tasks/from-transcript/route.ts', 'tareas desde transcripción'],
  ['lib/reels/generate.ts', 'idea de carrusel y guión adaptado'],
]

test('las funciones de texto pasan por el motor configurable, no por Anthropic a pelo', () => {
  for (const [file] of POR_EL_MOTOR) {
    assert.match(read(file), /completeText\(/, `${file} no usa el motor configurable`)
  }
  const claude = sinComentarios(read('lib/ai/claude.ts'))
  // Solo puede quedar UNA llamada directa a Anthropic: la de leer facturas (multimodal). Y con la
  // clave de la SUBCUENTA, no la del entorno del despliegue.
  const directas = [...claude.matchAll(/anthropic\([^)]*\)\.messages\.create/g)]
  assert.match(claude, /anthropic\(env\?\.ANTHROPIC_API_KEY/, 'la factura se lee con la clave del entorno')
  assert.equal(directas.length, 1, `hay ${directas.length} llamadas directas a Anthropic en claude.ts`)
  const extract = claude.slice(claude.indexOf('export async function extractInvoice'))
  assert.match(
    extract.slice(0, extract.indexOf('export async function', 10)),
    /anthropic\([^)]*\)\.messages\.create/,
    'la única llamada directa debería ser la de facturas'
  )
})

// Los modelos de texto de DeepSeek no ven imágenes ni PDFs: mandarles una factura devolvería una
// respuesta inventada sobre un archivo que no han leído.
test('leer facturas NO se enruta al motor de texto', () => {
  const claude = read('lib/ai/claude.ts')
  const extract = claude.slice(claude.indexOf('export async function extractInvoice'))
  const cuerpo = extract.slice(0, extract.indexOf('export async function', 10))
  assert.doesNotMatch(sinComentarios(cuerpo), /completeText\(/, 'la factura se está mandando a un modelo de texto')
  assert.match(read('lib/ai/provider.ts'), /extractInvoice/, 'el motor no documenta por qué las facturas quedan fuera')
})

// Sin esto, una clave guardada en Integraciones no la usa nadie: las rutas leían process.env, que
// solo trae la variable global de Vercel. Es la diferencia entre conectar DeepSeek y que sirva.
test('cada ruta de IA pasa la configuración de SU subcuenta', () => {
  const rutas = [
    'app/api/[tenant]/evergreen/ai/call/route.ts',
    'app/api/[tenant]/evergreen/cron/analyze-calls/route.ts',
    'app/api/[tenant]/evergreen/instagram/script/route.ts',
    'app/api/[tenant]/evergreen/instagram/transcribe/route.ts',
    'app/api/[tenant]/evergreen/contracts/templates/ai/route.ts',
    'lib/reels/generate.ts',
    'app/api/[tenant]/evergreen/tasks/from-transcript/route.ts',
  ]
  for (const ruta of rutas) {
    assert.match(read(ruta), /tenantAiEnv\(/, `${ruta} no pasa la configuración de su subcuenta`)
  }
  // Y la instantánea NO se vuelca a process.env, que es global al proceso: la clave de un cliente
  // no puede acabar atendiendo la petición de otro.
  const provider = sinComentarios(read('lib/ai/provider.ts'))
  assert.doesNotMatch(provider, /ensureConfig|process\.env\[[^\]]+\] =/, 'el motor muta el entorno global')
  assert.match(provider, /getTenantConfigWithFallback/)
})

// Un cambio de motor silencioso es una avería invisible: el resultado sale de otro modelo y nadie
// se entera de que el configurado está caído.
test('si responde el motor de repuesto, se dice cuál y por qué', () => {
  const provider = read('lib/ai/provider.ts')
  assert.match(provider, /engine: AiEngine/)
  assert.match(provider, /fallbackReason/)
  assert.match(provider, /console\.warn/)
  // Y sin repuesto configurado se propaga el error real en vez de devolver texto vacío, que el
  // llamante leería como "la IA no encontró nada".
  assert.match(provider, /if \(!env\.ANTHROPIC_API_KEY\?\.trim\(\)\) throw e/)
  assert.match(provider, /devolvió una respuesta vacía/)
})
