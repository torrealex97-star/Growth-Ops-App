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
const src = readFileSync(join(root, RUTA), 'utf8')
const codigo = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ── AUTENTICACIÓN ────────────────────────────────────────────────────────────────────────────
// Lo llama GHL, no un usuario: no hay sesión ni cookie. El secreto compartido es la única puerta.

test('el secreto se valida fail-closed y antes de leer el payload', () => {
  assert.match(codigo, /isValidWebhookSecret\(secret, process\.env\.GHL_WEBHOOK_SECRET\)/)
  const valida = codigo.indexOf('isValidWebhookSecret(')
  const lee = codigo.indexOf('await req.json()')
  assert.ok(valida > -1 && lee > -1, 'deben existir ambas operaciones')
  assert.ok(valida < lee, 'el secreto se comprueba antes de leer el cuerpo de un remitente sin autenticar')
})

test('un secreto ausente o incorrecto devuelve 401 y corta', () => {
  assert.match(codigo, /if \(!isValidWebhookSecret\([\s\S]{0,80}?\)\) \{\s*return NextResponse\.json\([^)]*status: 401/)
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

test('solo se acepta una subcuenta activa, y si no existe se devuelve 404', () => {
  assert.match(codigo, /\.from\('tenants'\)[\s\S]{0,200}?\.eq\('status', 'active'\)/)
  assert.match(codigo, /if \(!tenantRow\) return NextResponse\.json\([^)]*status: 404/)
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
