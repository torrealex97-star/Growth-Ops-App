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

// Hotmart EXIGE la cabecera `Authorization: Basic` en la petición de token, además de los parámetros.
// Sin ella responde 401 con las credenciales correctas, así que esta integración no podía conectar
// nunca — daba "Client ID o Secret inválidos" con un Client ID y un Secret perfectos.
test('Hotmart manda la cabecera Basic que su API exige', () => {
  const route = sinComentarios(read(ROUTE))
  const hotmart = route.slice(route.indexOf("group === 'hotmart'"))
  const cuerpo = hotmart.slice(0, hotmart.indexOf("group === 'whop'"))
  assert.match(cuerpo, /Authorization: `Basic \$\{basic\}`/, 'falta la cabecera Basic en el token de Hotmart')
  assert.match(cuerpo, /Buffer\.from\(`\$\{cfg\.HOTMART_CLIENT_ID\}:\$\{cfg\.HOTMART_CLIENT_SECRET\}`\)/)
  // Y se puede pegar el que muestra su panel, por si no coincide con el calculado.
  assert.match(cuerpo, /HOTMART_BASIC_TOKEN/)
  assert.match(read(CATALOG), /HOTMART_BASIC_TOKEN/)
})

// Un fallo del proveedor tiene que llegar a la pantalla como una causa con arreglo, no como el
// mensaje en inglés que Meta escribe para desarrolladores.
test('los errores de Meta se traducen a una causa, también dentro del cliente', () => {
  const client = sinComentarios(read('lib/meta/client.ts'))
  assert.match(client, /classifyMetaError\(json, res\.status\)/, 'el cliente sigue lanzando el mensaje crudo')
  assert.doesNotMatch(client, /Meta API error\$\{/, 'quedó el error en inglés sin clasificar')
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /classifyMetaError\(failed\[0\]\.body, failed\[0\]\.status\)/)
  // Y una respuesta 200 que trae `error` dentro NO puede darse por buena: Meta responde así a veces.
  assert.match(route, /ok: r\.ok && !j\.error/)
})

// Un espacio o un salto de línea pegados al copiar el App Secret rompen la firma appsecret_proof, y
// Meta responde "Invalid appsecret_proof" sin decir que sobra un carácter invisible: horas de
// revisar unas credenciales correctas.
test('las credenciales de Meta se recortan antes de firmar', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /const secret = appSecret\?\.trim\(\)/)
  assert.match(route, /\.update\(token\.trim\(\)\)/)
  const client = sinComentarios(read('lib/meta/client.ts'))
  assert.match(client, /createHmac\('sha256', secret\)\.update\(token\.trim\(\)\)/)
  assert.match(client, /createHmac\('sha256', cfg\.appSecret\.trim\(\)\)\.update\(cfg\.token\.trim\(\)\)/)
})

// Vaciar el campo de un secreto y guardar NO lo borra: el endpoint ignora los secretos en blanco a
// propósito (si no, el campo enmascarado los borraría al guardar cualquier otra cosa). Sin un botón
// de borrar, una credencial mal pegada se queda para siempre y la única salida es "Desconectar", que
// borra TODAS las de esa integración. Pasó de verdad: bloqueó Meta con un App Secret incorrecto.
test('un secreto guardado se puede borrar uno a uno', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /if \(secret && val === ''\) continue/, 'cambió el comportamiento de guardado')
  const page = read('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(page, /async function clearField/)
  assert.match(page, /JSON\.stringify\(\{ clear: \[key\] \}\)/, 'el borrado debe afectar a UNA clave')
  assert.match(page, /Borrar/)
  // Y lo que viene de una variable de entorno no se puede borrar desde aquí: decir "bórralo" sería
  // mandar a un botón que no existe.
  assert.match(page, /viene de una variable de entorno/)
})

// "Borra el App Secret" solo se puede afirmar si se ha comprobado que sin él conecta. Si sin firma
// tampoco conecta, el problema es otro y ese consejo manda al sitio equivocado.
test('el consejo sobre el App Secret se demuestra, no se supone', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /async function metaConectaSinFirma/)
  assert.match(route, /const sinFirma = await metaConectaSinFirma\(token, ver\)/)
  const bloque = route.slice(route.indexOf('const sinFirma'))
  assert.match(bloque.slice(0, 900), /sinFirma\s*\?/, 'el mensaje no depende de la comprobación')
  assert.match(bloque.slice(0, 900), /MISMA app/, 'falta el caso en el que el secreto sí hace falta')
})

// La configuración GUARDADA tiene que ser la configuración USADA. `ensureConfig` vuelca las
// credenciales de una subcuenta en process.env, que es global al proceso y nunca borra lo anterior:
// en el cron que recorre todas las subcuentas, la segunda heredaba el token de la primera y se
// llenaba con SUS campañas. Por eso las syncs de Meta reciben la config como argumento.
test('toda ruta que sincroniza Meta le pasa la config explícita de su subcuenta', () => {
  const rutas = [
    'app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts',
    'app/api/[tenant]/evergreen/cron/meta/route.ts',
    'app/api/[tenant]/evergreen/cron/meta-daily/route.ts',
    'app/api/[tenant]/evergreen/cron/meta-ads/route.ts',
    'app/api/[tenant]/evergreen/meta/sync/route.ts',
    'app/api/[tenant]/evergreen/meta/daily-sync/route.ts',
    'app/api/[tenant]/evergreen/meta/ads-sync/route.ts',
  ]
  for (const ruta of rutas) {
    const src = read(ruta)
    if (!/runMetaSync|runMetaDailySync|runMetaAdsSync/.test(src)) continue
    const code = sinComentarios(src)
    assert.doesNotMatch(code, /ensureConfig\(/, `${ruta} sigue volcando credenciales en process.env`)
    assert.match(code, /getTenantConfigWithFallback\(/, `${ruta} no lee la config de su subcuenta`)
    assert.match(code, /runMeta\w*Sync\(sb, [\w.]+, cfg/, `${ruta} no pasa la config a la sync`)
    // Y toda ejecución queda registrada: sin historial, "la tabla está vacía" no tiene causa.
    assert.match(code, /recordSyncRun\(/, `${ruta} sincroniza sin dejar constancia de la ejecución`)
  }
})

// Instagram tenía el mismo problema que Meta: el cron recorre todas las subcuentas en la misma
// lambda y `ensureConfig` no limpia process.env entre iteraciones. Y dos rutas (competencia,
// transcripción) leían las credenciales de process.env SIN cargarlas: en una lambda nueva no había
// ninguna y respondían "faltan credenciales" teniendo el token guardado.
test('las rutas de Instagram reciben la config explícita de su subcuenta', () => {
  const rutas = [
    'app/api/[tenant]/evergreen/cron/instagram/route.ts',
    'app/api/[tenant]/evergreen/instagram/sync/route.ts',
    'app/api/[tenant]/evergreen/instagram/competitors/route.ts',
    'app/api/[tenant]/evergreen/instagram/transcribe/route.ts',
    'app/api/[tenant]/evergreen/cron/youtube-backfill/route.ts',
    'app/api/[tenant]/evergreen/setting-ai/conversations/route.ts',
  ]
  for (const ruta of rutas) {
    const code = sinComentarios(read(ruta))
    assert.doesNotMatch(code, /ensureConfig\(/, `${ruta} vuelca credenciales en process.env`)
    assert.match(code, /getTenantConfigWithFallback\(/, `${ruta} no lee la config de su subcuenta`)
    assert.doesNotMatch(code, /getInstagramConfig\(\)/, `${ruta} lee las credenciales del entorno global`)
  }
  const client = sinComentarios(read('lib/instagram/client.ts'))
  assert.doesNotMatch(client, /process\.env\.(INSTAGRAM|META|IG_)/, 'el cliente de IG lee del entorno')
  // Y la sync de Instagram deja de tragarse los errores de escritura.
  const sync = sinComentarios(read('lib/instagram/sync.ts'))
  assert.doesNotMatch(sync, /if \(!error\) (mediaSynced|fbReelsSynced)\+\+/)
  assert.match(sync, /failures\.push\(/)
})

// Las credenciales se leen SOLO de lo que se pasa. Un `process.env.META_*` aquí devuelve el proceso
// al fallo de arriba, y además hace imposible saber qué se usó al sincronizar.
test('el cliente y la sync de Meta no leen credenciales del entorno', () => {
  for (const archivo of ['lib/meta/client.ts', 'lib/meta/sync.ts']) {
    const code = sinComentarios(read(archivo))
    assert.doesNotMatch(code, /process\.env\.META_/, `${archivo} lee credenciales de process.env`)
  }
})

// `if (error) continue` convertía un fallo total de escritura en `ok: true, synced: 0`: la tabla se
// quedaba vacía, el panel decía "vacía" y el motivo no aparecía en ninguna parte. Y como
// campaign_daily y campaign_ads se enlazan por el mapa de campañas, un único fallo aquí vaciaba tres
// tablas de golpe.
test('la sync de Meta no se traga ningún fallo de escritura', () => {
  const code = sinComentarios(read('lib/meta/sync.ts'))
  assert.doesNotMatch(code, /if \(!error\) synced \+=/, 'un upsert fallido no puede pasar en silencio')
  assert.doesNotMatch(code, /catch\(\(\) => 0\)/, 'una cuenta que falla entera no puede leerse como "gastó 0"')
  for (const tabla of ['campaigns', 'campaign_daily', 'campaign_ads', 'expenses']) {
    assert.ok(code.includes(`from('${tabla}')`), `la sync ya no escribe en ${tabla}`)
  }
  // Cada resultado arrastra sus fallos parciales hasta el historial.
  assert.equal((code.match(/failures\.push\(/g) || []).length >= 5, true, 'faltan fallos por reportar')
  assert.match(code, /failures,\s*\}/)
})

test('el histórico de Meta recupera campañas archivadas y sincroniza también anuncios', () => {
  const sync = sinComentarios(read('lib/meta/sync.ts'))
  const client = sinComentarios(read('lib/meta/client.ts'))
  const history = sinComentarios(read('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts'))

  assert.match(client, /campaign_id,campaign_name,spend/, 'el gasto diario no trae el nombre canónico')
  assert.match(sync, /missingCampaigns/, 'las campañas que solo aparecen en insights siguen huérfanas')
  assert.match(sync, /onConflict: 'tenant_id,provider,external_id'/, 'el rescate no es idempotente por tenant')
  assert.match(history, /runMetaAdsSync/, 'Cargar histórico sigue dejando campaign_ads vacía')
  assert.match(history, /job: 'meta-ads'/, 'los anuncios no quedan registrados en el historial')
})

// "He borrado el App Secret y sigue dando el mismo error": el valor borrado de la base de datos
// seguía vivo en process.env el resto de la vida de la lambda, porque ensureConfig lo había volcado.
test('borrar un campo lo borra de verdad: cuenta filas y retira el valor del proceso', () => {
  const code = sinComentarios(read(ROUTE))
  assert.match(code, /\.in\('key', clearable\)\s*\.select\('key'\)/s, 'un delete sin .select() no sabe si borró algo')
  assert.match(code, /stillInEnv/, 'hay que decirlo si la clave sigue llegando por variable de entorno')
  // Y la raíz del problema está eliminada: nada vuelca credenciales en process.env, que es global al
  // proceso y no se limpia entre peticiones de subcuentas distintas.
  const config = sinComentarios(read('lib/config.ts'))
  assert.doesNotMatch(config, /export async function ensureConfig/, 'ensureConfig ha vuelto')
  assert.doesNotMatch(config, /process\.env\[[^\]]+\] = /, 'algo vuelve a escribir en process.env')
})

// El historial es la pieza que faltaba para que el panel pueda decir la causa. Con cerrojo, para que
// el cron y el botón manual no corran a la vez, y con aislamiento por subcuenta.
test('la migración del historial trae cerrojo de concurrencia y RLS por subcuenta', () => {
  const sql = read('supabase/migrations/20260913190000_integration_sync_runs.sql')
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.integration_sync_runs/)
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS integration_sync_runs_one_running_idx[\s\S]*?WHERE status = 'running'/
  )
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /AS RESTRICTIVE FOR ALL/)
  for (const op of ['FOR SELECT', 'FOR ALL']) assert.ok(sql.includes(op), `falta politica ${op}`)
  assert.match(sql, /error_message TEXT/)
})

// Stripe: tres de las cuatro llamadas pedían limit=100 sin paginar. Truncar en silencio es peor que
// fallar — la base de clientes "estaba completa" dejando fuera todo el historial anterior.
test('todo lo que lista Stripe pagina por el cliente compartido', () => {
  for (const archivo of ['lib/finance/stripeCustomers.ts', 'lib/finance/stripeReconciliation.ts']) {
    const code = sinComentarios(read(archivo))
    assert.match(code, /stripeList</, `${archivo} no pagina`)
    assert.doesNotMatch(code, /fetch\(`https:\/\/api\.stripe\.com/, `${archivo} vuelve a llamar a Stripe a mano`)
  }
  // La conciliación ya no coteja contra "los 1.000 cobros más recientes": busca por las referencias
  // que aparecen. Con los pagos paginados, un cobro más antiguo que ese tope se habría reportado como
  // "sin registrar", y registrarlo otra vez duplicaría la facturación.
  const recon = sinComentarios(read('lib/finance/stripeReconciliation.ts'))
  assert.doesNotMatch(recon, /\.limit\(1000\)/)
  assert.match(recon, /\.in\('payment_reference', lote\)/)
  assert.match(recon, /truncated/)
})

test('una lista de Stripe incompleta no se guarda como sincronización correcta', () => {
  const code = sinComentarios(read('app/api/[tenant]/evergreen/settings/integraciones/stripe-customers/route.ts'))
  assert.match(code, /recordSyncRun\(/)
  assert.match(code, /failures: r\.truncated/)
})

// Toda credencial que el usuario puede configurar en el panel tiene que USARSE de verdad. El patrón
// que lo rompía: la librería leía `process.env.X` y el panel comprobaba la de la subcuenta, así que
// la tarjeta salía en verde y el trabajo real seguía yendo con la clave del despliegue (o sin
// ninguna). Estas librerías reciben ahora sus credenciales como argumento.
test('las credenciales configurables no se leen del entorno del proceso', () => {
  const PROHIBIDO = {
    'lib/calendly.ts': /process\.env\.CALENDLY_/,
    'lib/sequra/client.ts': /process\.env\.SEQURA_/,
    'lib/sequra/syncDelinquents.ts': /process\.env\.SEQURA_/,
    'lib/youtube/client.ts': /process\.env\.YOUTUBE_/,
    'lib/instagram/client.ts': /process\.env\.(INSTAGRAM_|IG_|META_)/,
    'lib/meta/client.ts': /process\.env\.META_/,
    'lib/reels/generate.ts': /process\.env\.GROQ_/,
    'lib/ai/groq.ts': /process\.env\.GROQ_/,
  }
  for (const [archivo, patron] of Object.entries(PROHIBIDO)) {
    assert.doesNotMatch(sinComentarios(read(archivo)), patron, `${archivo} vuelve a leer la credencial del entorno`)
  }
  // Resend sí admite el entorno como FALLBACK (los flujos públicos de firma no tienen subcuenta
  // resuelta), pero la clave de la subcuenta tiene prioridad.
  const resend = sinComentarios(read('lib/email/resend.ts'))
  assert.match(resend, /mail\?\.RESEND_API_KEY\?\.trim\(\) \|\| process\.env\.RESEND_API_KEY/)
})

// Una sola implementación de transcribir con Groq: estaba copiada tres veces, con tres variantes
// distintas (una con timeout y dos sin él, y dos listas de extensiones diferentes).
test('la transcripción con Groq vive en un solo sitio', () => {
  const copias = [
    'app/api/[tenant]/evergreen/ai/call/route.ts',
    'app/api/[tenant]/evergreen/instagram/transcribe/route.ts',
    'lib/reels/generate.ts',
  ]
  for (const p of copias) {
    const code = sinComentarios(read(p))
    assert.doesNotMatch(code, /async function transcribeGroq/, `${p} tiene su propia copia`)
    assert.doesNotMatch(code, /api\.groq\.com/, `${p} llama a Groq a mano`)
    assert.match(code, /transcribeAudio\(/, `${p} no usa la implementación compartida`)
  }
  const groq = read('lib/ai/groq.ts')
  assert.match(groq, /AbortSignal\.timeout/)
  assert.match(groq, /GROQ_LIMIT_BYTES/)
})
