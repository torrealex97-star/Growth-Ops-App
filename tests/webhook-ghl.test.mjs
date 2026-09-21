import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// S0.3 — REGRESIÓN GOLDEN DEL WEBHOOK DE GHL (docs/S0-2-JOURNEYS-CRITICOS.md, J1).
//
// Este webhook es la ÚNICA entrada automática de personas al sistema: 972 contactos y 559 agendas
// en producción entraron por aquí. Hasta ahora no lo cubría ningún test.
//
// Estos tests FIJAN EL COMPORTAMIENTO ACTUAL antes de que F1 reescriba la ruta para escribir en
// `raw_events`. No corrigen nada: si algo de aquí falla tras un cambio, es que el cambio movió una
// garantía que ya existía.
//
// Estilo de la casa para webhooks (ver `stripe-webhook-route.test.mjs`): invariantes estáticos
// sobre el código. No ejecutan la ruta — eso exigiría una base de datos — así que cubren
// estructura y orden, no valores calculados. Los comentarios se eliminan antes de analizar para
// que un invariante nunca "pase" porque la frase aparece en una nota.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const RUTA = 'app/api/[tenant]/evergreen/webhooks/ghl/route.ts'
const read = (p) => readFileSync(join(root, p), 'utf8')
const src = read(RUTA)
const codigo = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ── AUTENTICACIÓN ────────────────────────────────────────────────────────────────────────────
// Lo llama GHL, no un usuario: no hay sesión ni cookie. El secreto compartido es la única puerta.

test('el secreto se valida fail-closed y antes de leer el payload', () => {
  // El secreto es POR SUBCUENTA, con el entorno solo como respaldo. Antes se leía únicamente de
  // `process.env`, y el catálogo de integraciones declara `GHL_WEBHOOK_SECRET` como campo
  // obligatorio del panel de cada subcuenta: la app pedía configurarlo donde nadie lo leía. Un
  // secreto global además permitiría que el webhook de un cliente escribiera en otro cambiando el
  // slug de la URL.
  assert.match(codigo, /isValidWebhookSecret\(secret, cfg\.GHL_WEBHOOK_SECRET \|\| process\.env\.GHL_WEBHOOK_SECRET\)/)
  const valida = codigo.indexOf('isValidWebhookSecret(')
  const lee = codigo.indexOf('await req.json()')
  assert.ok(valida > -1 && lee > -1, 'deben existir ambas operaciones')
  assert.ok(valida < lee, 'el secreto se comprueba antes de leer el cuerpo de un remitente sin autenticar')
})

test('un secreto ausente o incorrecto devuelve 401 y corta', () => {
  // El log de observabilidad (401: cabecera ausente o inválida) puede preceder al return: sin él,
  // un webhook mal dado de alta en GHL era indetectable — la llamada llegaba y no quedaba rastro.
  assert.match(codigo, /if \(!isValidWebhookSecret\([\s\S]{0,80}?\)\) \{[\s\S]{0,220}?status: 401/)
})

// ── FRONTERA DE SUBCUENTA ────────────────────────────────────────────────────────────────────
// Este handler usa el cliente service-role, que salta RLS. El aislamiento depende ENTERO de que el
// tenant salga de la URL y de que cada query lo aplique a mano.

test('el tenant sale de los params de la ruta, nunca del cuerpo', () => {
  assert.match(codigo, /const \{ tenant \} = await params/)
  assert.match(codigo, /\.from\('tenants'\)[\s\S]{0,200}?\.eq\('slug', tenant\)/)
  // Un payload que traiga tenant/tenant_id/tenantId no debe poder elegir subcuenta.
  assert.doesNotMatch(codigo, /payload\.tenant/)
  assert.doesNotMatch(codigo, /payload\.tenant_id/)
  assert.doesNotMatch(codigo, /payload\.tenantId/)
})

test('subcuenta inexistente y secreto incorrecto son indistinguibles: ambos 401', () => {
  // Antes la subcuenta se resolvía DESPUÉS de autenticar, así que un 404 no filtraba nada. Ahora el
  // tenant hay que resolverlo primero —su configuración guarda el secreto—, y devolver 404 dejaría
  // enumerar slugs sin credencial alguna comparando códigos de estado.
  assert.match(codigo, /\.from\('tenants'\)[\s\S]{0,200}?\.eq\('status', 'active'\)/)
  // El warn de observabilidad puede preceder al return (401: subcuenta inexistente o inactiva).
  assert.match(codigo, /if \(!tenantRow\) \{[\s\S]{0,220}?status: 401/)
  assert.doesNotMatch(codigo, /Subcuenta no encontrada/)
})

test('toda lectura o escritura de tablas de subcuenta lleva tenant_id', () => {
  const tablas = ['contacts', 'appointments', 'contact_attributions', 'qualification_questions', 'audit_logs']
  // Excepciones justificadas, no descuidos. Cada una se acota por un id que YA se obtuvo con una
  // consulta filtrada por tenant_id, así que volver a filtrar sería redundante.
  const derivadoDeConsultaAcotada = [
    'update({ last_touch_at: now', // attr.id viene de un select con .eq('tenant_id', tenantId)
  ]
  // Objetos de payload que llevan tenant_id en su definición, no en la cadena de la query.
  const payloadsConTenant = ['newAppt']

  const trozos = codigo.split(/\.from\('/).slice(1)
  const sinAcotar = []
  for (const trozo of trozos) {
    const cierre = trozo.indexOf("'")
    const tabla = trozo.slice(0, cierre)
    if (!tablas.includes(tabla)) continue
    const bloque = trozo.slice(cierre, cierre + 900)
    const acotado =
      /\.eq\('tenant_id', tenantId\)/.test(bloque) ||
      /tenant_id: tenantId/.test(bloque) ||
      payloadsConTenant.some((v) => new RegExp(`\\.(insert|upsert)\\(${v}\\b`).test(bloque)) ||
      derivadoDeConsultaAcotada.some((frag) => bloque.includes(frag))
    if (!acotado) sinAcotar.push(`${tabla}: ${bloque.replace(/\s+/g, ' ').trim().slice(0, 100)}`)
  }
  assert.deepEqual(sinAcotar, [], `queries sin acotar por subcuenta:\n${sinAcotar.join('\n')}`)
})

test('el objeto de la agenda lleva tenant_id en su propia definición', () => {
  // El upsert se acota por el payload, no por la cadena: si alguien quita esta línea, la agenda
  // nacería fuera de su subcuenta y el test de arriba dejaría de protegerla.
  assert.match(codigo, /const newAppt = \{\s*tenant_id: tenantId,/)
})

test('resolver un usuario por email exige pertenencia a la subcuenta', () => {
  // `users` es global (la pertenencia vive en tenant_members): sin este filtro, una agenda —con su
  // comisión— podía caer en el closer de otra subcuenta.
  assert.match(codigo, /function userIdByEmail\([\s\S]{0,400}?firstMemberOf\(\s*sb,\s*tenantId/)
})

// ── IDEMPOTENCIA ─────────────────────────────────────────────────────────────────────────────
// GHL reintenta. Un reenvío no puede crear dos agendas ni dos contactos.

test('la agenda se inserta con upsert por (tenant_id, external_id), no por external_id suelto', () => {
  assert.match(codigo, /\.upsert\(newAppt, \{ onConflict: 'tenant_id,external_id' \}\)/)
  // La clave global sería un cruce entre subcuentas.
  assert.doesNotMatch(codigo, /onConflict: 'external_id'/)
})

test('la pregunta de cualificación se registra por subcuenta y sin perder el error', () => {
  assert.match(codigo, /\.from\('qualification_questions'\)[\s\S]{0,300}?tenant_id: tenantId/)
  assert.match(codigo, /onConflict: 'tenant_id,slug'/)
  assert.doesNotMatch(codigo, /onConflict: 'slug'/)
  // Falló en silencio durante semanas por no mirar el error: la tabla quedó vacía habiendo agendas.
  assert.match(codigo, /qqError/)
})

test('el contacto se resuelve con la RPC atómica, acotada por subcuenta', () => {
  // La resolución vive en `contacts_get_or_create` (migración 20260914150000), no en la ruta: una
  // secuencia de selects seguida de un insert tenía una carrera entre dos webhooks simultáneos.
  // Aquí solo se fija que la ruta delegue y le pase la subcuenta y los tres identificadores.
  assert.match(codigo, /getOrCreateContact\(sb, tenantId, \{/)
  const llamada = codigo.slice(codigo.indexOf('getOrCreateContact(sb, tenantId, {'))
  assert.match(llamada.slice(0, 400), /ghlContactId/)
  assert.match(llamada.slice(0, 400), /email/)
  assert.match(llamada.slice(0, 400), /phone/)
})

// ── FALLOS ───────────────────────────────────────────────────────────────────────────────────

test('sin ningún identificador se responde 400 y no se crea nada', () => {
  assert.match(codigo, /if \(!email && !phone && !ghlContactId\)[\s\S]{0,300}?status: 400/)
})

test('los fallos de escritura se devuelven, no se tragan', () => {
  assert.match(codigo, /'Error creando contacto'[\s\S]{0,120}?status: 500/)
  assert.match(codigo, /'Error creando agenda'[\s\S]{0,120}?status: 500/)
})

// ── ESTADO CONOCIDO, FIJADO A PROPÓSITO ──────────────────────────────────────────────────────

test('HOY no se escribe capa raw: este test debe romperse cuando F1 la añada', () => {
  // `contact_attributions` está a 0 filas en producción con 972 contactos porque la atribución solo
  // se escribe `if (hasUtm || source)` y GHL no está enviando UTMs. Sin el payload original
  // guardado no se puede diagnosticar a posteriori ni reprocesar un día.
  //
  // Se fija como está para que el cambio sea deliberado: cuando F1 escriba en `raw_events`, este
  // test falla y quien lo actualice tiene delante el motivo.
  assert.doesNotMatch(codigo, /raw_events/, 'si F1 ya añadió la capa raw, actualiza este test y S0-2')
  assert.match(codigo, /if \(hasUtm \|\| source\)/)
})

test('el secreto se lee de la subcuenta, con el entorno solo como respaldo', () => {
  // Patrón de la casa, igual que `stripe-webhook-route.test.mjs`: la configuración de la subcuenta
  // manda. Que el catálogo lo declare obligatorio y el webhook no lo leyera fue el motivo real de
  // que GHL no cargara citas: 401 en cada llamada, sin pista de por qué.
  assert.match(codigo, /getTenantConfigWithFallback\(tenantId, true\)/)
  const resuelve = codigo.indexOf("from('tenants')")
  const autentica = codigo.indexOf('isValidWebhookSecret(')
  assert.ok(resuelve > -1 && autentica > -1)
  assert.ok(resuelve < autentica, 'hay que resolver la subcuenta para poder leer SU secreto')
})

test('el catálogo declara GHL_WEBHOOK_SECRET como obligatorio, y ahora el webhook lo usa', () => {
  // Si alguien lo quitara del catálogo, el panel dejaría de pedirlo y las subcuentas nuevas
  // quedarían sin secreto — volviendo al 401 silencioso.
  const catalogo = read('lib/integrations-catalog.ts')
  assert.match(catalogo, /required: \['GHL_API_TOKEN', 'GHL_LOCATION_ID', 'GHL_WEBHOOK_SECRET'\]/)
})
