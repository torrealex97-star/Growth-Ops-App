import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const ROUTE = 'app/api/[tenant]/evergreen/settings/integraciones/route.ts'
const CATALOG = 'lib/integrations-catalog.ts'
const HISTORY = 'lib/integrations/history.ts'

// La luz de la pantalla sale de este veredicto guardado. Si no se guardara, al recargar la pantalla
// volvería a "configurada" y el usuario no sabría nunca si su integración funciona de verdad.
test('cada comprobación se guarda, y una comprobación es una llamada real a la API', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /await saveLastCheck\(tenantId, group, result\)/)
  assert.match(route, /HEALTH_KEY = 'INTEGRATION_HEALTH'/)
  assert.match(route, /onConflict: 'tenant_id,key'/, 'el estado debe guardarse por subcuenta')
  // probeGueGroup llama a fetch contra cada proveedor: una comprobación que solo mire si el campo
  // está relleno sería el "conectado" mentiroso que esto viene a quitar.
  const probe = route.slice(route.indexOf('async function probeGroup'))
  assert.ok([...probe.matchAll(/await fetch\(/g)].length >= 8, 'faltan comprobaciones reales contra APIs')
})

// El mensaje lo escribe la API externa y cambia sin avisar; el código lo ponemos nosotros y es lo
// que permite decirle al usuario qué hacer sin que tenga que entender de tokens.
test('los fallos llevan un código estable para poder dar el arreglo', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /function codeFromStatus/)
  assert.match(route, /status === 401\) return 'token_invalido'/)
  assert.match(route, /status === 403\) return 'sin_permisos'/)
  // Un fallo de red NO puede reportarse como credencial inválida: mandaría a rotar un token bueno.
  assert.match(route, /code: 'red'/)
  const codigos = [...route.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1])
  const conocidos = Object.keys(
    Object.fromEntries([...read('lib/integrations/health.ts').matchAll(/^ {2}([a-z_]+):/gm)].map((m) => [m[1], true]))
  )
  for (const code of new Set(codigos)) {
    if (code === 'red') continue
    assert.ok(
      conocidos.includes(code) || ['limite_de_uso', 'respuesta_inesperada'].includes(code),
      `el código ${code} no tiene arreglo declarado en health.ts`
    )
  }
})

// Meta retira versiones por calendario. v21.0 (la que estaba escrita a mano en seis archivos) quedó
// deprecada para Marketing API en junio de 2026: las llamadas empiezan a fallar solas sin que nadie
// haya tocado nada.
test('la versión de la API de Meta está en un solo sitio y no es una deprecada', () => {
  const version = read('lib/meta/api-version.ts')
  assert.match(version, /export const META_API_VERSION = 'v2[5-9]\.0'/)
  const actual = version.match(/META_API_VERSION = '(v[\d.]+)'/)[1]
  const deprecadas = [...version.matchAll(/'(v\d+\.0)',/g)].map((m) => m[1])
  assert.ok(!deprecadas.includes(actual), `la versión por defecto ${actual} está en la lista de deprecadas`)

  for (const file of [
    'lib/meta/client.ts',
    'lib/instagram/client.ts',
    'app/api/[tenant]/evergreen/settings/integraciones/route.ts',
  ]) {
    assert.doesNotMatch(read(file), /'v2[0-3]\.0'/, `${file} fija a mano una versión vieja de la API de Meta`)
  }
})

// Prometer "todo tu histórico" y traer 30 días es mentir justo donde el usuario todavía no puede
// contrastar nada.
test('cada carga de histórico declara qué trae y hasta dónde llega', () => {
  const history = read(HISTORY)
  const providers = [...history.matchAll(/provider: '([a-z]+)'/g)].map((m) => m[1])
  assert.ok(providers.length >= 5, 'faltan proveedores con carga de histórico')
  const bloques = history.split(/^ {2}[a-z]+: \{$/m).slice(1)
  for (const bloque of bloques) {
    assert.match(bloque, /brings: '[^']{20,}/, 'un proveedor no dice qué trae')
    assert.match(bloque, /reach: '[^']{20,}/, 'un proveedor no dice hasta dónde llega')
  }
  // Meta conserva 37 meses de métricas por día: pedir menos en una carga puntual que el usuario ha
  // pedido expresamente sería dejarse datos que sí existen.
  assert.match(history, /META_MAX_DAYS = 1125/)
  const sync = read('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts')
  assert.match(sync, /HISTORY_CAPABILITIES\.meta\.sinceDays/, 'la carga de Meta no usa el máximo declarado')
})

// Una integración marcada como "probable" en el catálogo pero sin rama en el comprobador dejaría al
// usuario pulsando un botón que no comprueba nada.
test('toda integración con prueba declarada tiene su comprobación escrita', () => {
  const catalog = read(CATALOG)
  const route = read(ROUTE)
  const bloques = catalog.split(/^ {2}\{$/m).slice(1)
  const conTest = bloques
    .filter((b) => /test: true/.test(b))
    .map((b) => b.match(/id: '([a-z0-9-]+)'/)?.[1])
    .filter(Boolean)
  assert.ok(conTest.length >= 10, 'no se han extraído los grupos con prueba')
  const sinComprobacion = conTest.filter((id) => !route.includes(`group === '${id}'`))
  assert.deepEqual(sinComprobacion, [], `estas integraciones dicen tener prueba pero no la tienen: ${sinComprobacion}`)
})

// El formulario de Meta tenía cinco campos cuando para conectar hace falta uno. Quien no sabe qué es
// un appsecret_proof rellena lo que no debe o abandona creyendo que le falta información.
test('conectar pide lo mínimo y lo demás va plegado', () => {
  const catalog = read(CATALOG)
  const page = read('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(catalog, /advanced\?: boolean/)
  // Lo avanzado NO puede ser algo obligatorio: esconder un campo requerido deja al usuario sin saber
  // por qué no conecta.
  const bloques = catalog.split(/^ {2}\{$/m).slice(1)
  for (const bloque of bloques) {
    const id = bloque.match(/id: '([a-z0-9-]+)'/)?.[1]
    const required = bloque.match(/required: \[([^\]]*)\]/)?.[1] ?? ''
    for (const key of [...required.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1])) {
      const campo = bloque.slice(bloque.indexOf(`key: '${key}'`))
      const hasta = campo.indexOf('},')
      assert.doesNotMatch(
        campo.slice(0, hasta > 0 ? hasta : 200),
        /advanced: true/,
        `${id}: ${key} es obligatorio y está escondido en avanzadas`
      )
    }
  }
  assert.match(page, /!f\.hidden && !f\.advanced/, 'el formulario principal no separa lo avanzado')
  assert.match(page, /Opciones avanzadas/)
})

// Pedir el `act_…` a mano obliga a buscarlo en el panel de Meta. Y obligar a guardar el token antes
// de poder buscar haría guardar tokens inválidos para descubrir que lo son.
test('la cuenta de Meta se elige de una lista, sin guardar el token antes', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /action === 'meta-accounts'/)
  assert.match(route, /listMetaAccounts\(auth\.tenantId, body\.token\)/)
  assert.match(route, /\(tokenSinGuardar \|\| ''\)\.trim\(\) \|\| cfg\.META_ACCESS_TOKEN/)
  // El token que llega sin guardar NO se persiste en esa acción.
  const fn = route.slice(route.indexOf('async function listMetaAccounts'))
  const hasta = fn.indexOf('\n}\n')
  assert.doesNotMatch(fn.slice(0, hasta), /integration_settings|upsert/, 'la búsqueda de cuentas guarda el token')

  const page = read('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(page, /Buscar cuentas/)
  assert.match(page, /name="meta-account"/, 'no hay dónde elegir la cuenta')
  // Una cuenta cerrada o con deuda no devuelve datos: se avisa antes de elegirla.
  assert.match(page, /inactiva en Meta/)
})

// Este catálogo decide si una integración sale "con datos" o "sin datos". Si apunta a una tabla que
// no existe, el panel dice "sin datos" para siempre y manda a revisar credenciales que están bien:
// exactamente el fallo que este módulo existe para evitar. Pasó de verdad con `instagram_posts`,
// que no está en ninguna migración.
test('cada sincronización apunta a una tabla que existe de verdad', () => {
  const defs = read('lib/ops/sync-health.ts')
  const tablas = [...new Set([...defs.matchAll(/^ {4}table: '([a-z_]+)',$/gm)].map((m) => m[1]))]
  assert.ok(tablas.length >= 8, 'no se han extraído las tablas del catálogo')

  const migraciones = readdirSync(join(root, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(root, 'supabase/migrations', f), 'utf8'))
    .join('\n')

  const inexistentes = tablas.filter(
    (t) => !new RegExp(`CREATE TABLE (IF NOT EXISTS )?public\\.${t}\\b`).test(migraciones)
  )
  assert.deepEqual(inexistentes, [], `estas tablas no las crea ninguna migración: ${inexistentes.join(', ')}`)
})
