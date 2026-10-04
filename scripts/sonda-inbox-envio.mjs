// SONDA QA — verificación en vivo del envío de respuestas del inbox GHL (petición de Alex).
//
// Llama a las rutas de PRODUCCIÓN que usa la propia UI (mismo middleware, mismo requireTenant,
// misma resolución contra el snapshot del tenant): nada del flujo real se reimprime ni se
// simula, y ni el token de GHL ni CONFIG_ENC_KEY salen nunca del servidor de Vercel.
//
//   list     — prepara un usuario QA efímero con membresía mínima en el tenant, inicia sesión
//              Supabase (password grant) y llama a GET /api/<slug>/evergreen/setting-ai/conversations
//              (?platform=ghl). Imprime un resumen SIN datos personales (nombres/teléfonos
//              enmascarados) para elegir el contacto controlado del envío de prueba.
//   send     — POST /api/<slug>/evergreen/setting-ai/conversations/reply con la conversación y el
//              texto dados, y después re-lee la bandeja para confirmar que el mensaje quedó EN esa
//              conversación y con dirección 'agente'.
//   cleanup  — borra el usuario QA y sus filas (membresía, perfil). Idempotente.
//
// Uso: node scripts/sonda-inbox-envio.mjs <slug> list | send <conversationId> "<texto>" | cleanup
//
// Seguridad: NUNCA imprime tokens, cookies, passwords ni JWTs. El usuario QA es sintético
// (qa-inbox-envio@qa-e2e.test, misma convención que supabase/functions/e2e-seed): su password se
// genera por ejecución, no da acceso a ningún dato fuera de su membresía 'member' y muere con él.
const { createClient } = await import('@supabase/supabase-js')
const { createServerClient } = await import('@supabase/ssr')
const { randomUUID } = await import('node:crypto')
const { leerEnvLocal } = await import('./env-local.mjs')

const EMAIL_QA = 'qa-inbox-envio@qa-e2e.test'
const NOMBRE_QA = 'QA Inbox Envío'

const env = leerEnvLocal()
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY // La base de producción se pasa por entorno (SONDA_BASE o NEXT_PUBLIC_SITE_URL): el script no
// contiene dominios escritos.
const BASE = (
  process.env.SONDA_BASE ||
  env.SONDA_BASE ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  env.NEXT_PUBLIC_SITE_URL ||
  ''
).replace(/\/+$/, '')

if (!url || !anonKey || !serviceKey || !BASE) {
  console.error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY y una base válida (SONDA_BASE o NEXT_PUBLIC_SITE_URL) en el entorno'
  )
  process.exit(1)
}

const slug = process.argv[2]
const modo = process.argv[3] || ''
if (!slug || !['list', 'send', 'cleanup'].includes(modo)) {
  console.error('Uso: node scripts/sonda-inbox-envio.mjs <slug> list | send <conversationId> "<texto>" | cleanup')
  process.exit(1)
}

const sbAdmin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Enmascara cualquier dato personal antes de imprimirlo: nombres a iniciales, emails a dominio,
// teléfonos a últimos 4 dígitos. El listado es para ELEGIR un contacto, no para leer datos.
function enmascarar(valor) {
  if (!valor) return '(sin nombre)'
  const t = String(valor).trim()
  if (t.includes('@')) {
    const [u, d] = t.split('@')
    return `${u.slice(0, 2)}***@${d}`
  }
  const digitos = t.replace(/\D/g, '')
  if (digitos.length >= 4) return `${t.slice(0, 2)}***…${digitos.slice(-4)}`
  return `${t.slice(0, 2)}***`
}

// Prepara tenant + usuario QA + sesión, y devuelve lo necesario para llamar a producción.
async function preparar() {
  const { data: tenant, error: tErr } = await sbAdmin
    .from('tenants')
    .select('id, slug, status')
    .eq('slug', slug)
    .maybeSingle()
  if (tErr) throw new Error(`tenants: ${tErr.message}`)
  if (!tenant || tenant.status !== 'active') throw new Error(`tenant "${slug}" inexistente o inactivo`)

  // Presencia de la credencial GHL (solo claves, jamás valores).
  const { data: cfgRows, error: cErr } = await sbAdmin
    .from('integration_settings')
    .select('key')
    .eq('tenant_id', tenant.id)
    .in('key', ['GHL_API_TOKEN', 'GHL_LOCATION_ID'])
  if (cErr) throw new Error(`integration_settings: ${cErr.message}`)
  const claves = new Set((cfgRows ?? []).map((r) => r.key))
  if (!claves.has('GHL_API_TOKEN') || !claves.has('GHL_LOCATION_ID'))
    throw new Error('el tenant no tiene credencial GHL configurada')

  // Usuario QA idempotente (si existe se reutiliza; password nueva por ejecución, nunca impresa).
  const password = randomUUID() + 'Aa1!'
  const { data: listed } = await sbAdmin.auth.admin.listUsers({ perPage: 500 })
  const existente = (listed?.users ?? []).find((u) => u.email === EMAIL_QA)
  let userId
  if (existente) {
    const { error } = await sbAdmin.auth.admin.updateUserById(existente.id, { password, email_confirm: true })
    if (error) throw new Error(`updateUserById: ${error.message}`)
    userId = existente.id
  } else {
    const { data: creada, error } = await sbAdmin.auth.admin.createUser({
      email: EMAIL_QA,
      password,
      email_confirm: true,
    })
    if (error) throw new Error(`createUser: ${error.message}`)
    userId = creada.user.id
  }
  // Perfil + membresía mínima: mismo patrón canónico que ensureUser en supabase/functions/e2e-seed.
  const { data: rol } = await sbAdmin.from('roles').select('id').eq('key', 'closer').maybeSingle()
  const { error: uErr } = await sbAdmin
    .from('users')
    .upsert({ id: userId, full_name: NOMBRE_QA, email: EMAIL_QA, role_id: rol?.id ?? null, is_active: true })
  if (uErr) throw new Error(`users.upsert: ${uErr.message}`)
  const { error: mErr } = await sbAdmin
    .from('tenant_members')
    .upsert({ tenant_id: tenant.id, user_id: userId, role: 'member' }, { onConflict: 'tenant_id,user_id' })
  if (mErr) throw new Error(`tenant_members.upsert: ${mErr.message}`)

  // Sesión por password grant + cookie EXACTA que exige el middleware: la serializa @supabase/ssr
  // (mismo formato de cookie que el navegador), nunca a mano.
  const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: sesion, error: sErr } = await anon.auth.signInWithPassword({ email: EMAIL_QA, password })
  if (sErr || !sesion?.session) throw new Error(`signInWithPassword: ${sErr?.message || 'sin sesión'}`)
  const jar = {}
  const ssr = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value: String(value) })),
      setAll: (cs) => {
        for (const c of cs) jar[c.name] = c.value
      },
    },
  })
  const { error: setErr } = await ssr.auth.setSession({
    access_token: sesion.session.access_token,
    refresh_token: sesion.session.refresh_token,
  })
  if (setErr) throw new Error(`setSession: ${setErr.message}`)
  const cookie = Object.entries(jar)
    .map(([n, v]) => `${n}=${v}`)
    .join('; ')
  if (!cookie) throw new Error('no se pudo serializar la cookie de sesión')
  return { tenantId: tenant.id, userId, cookie }
}

// Bandeja GHL por la ruta de producción (GET = snapshot + metadatos de paginación).
async function bandeja(cookie) {
  const res = await fetch(`${BASE}/api/${slug}/evergreen/setting-ai/conversations?platform=ghl`, {
    headers: { Cookie: cookie, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

async function modoList(cookie) {
  console.log(`Entorno: ${BASE} · tenant: ${slug}`)
  const { status, body } = await bandeja(cookie)
  console.log(`GET /conversations?platform=ghl → HTTP ${status}`)
  if (!body.configured) {
    console.log(`configured:false — motivo: ${body.motivo || body.error || '(sin motivo)'}`)
    return
  }
  const convs = body.conversations ?? []
  console.log(`conversaciones: ${convs.length} (total declarado: ${body.total ?? 's/d'}, hayMas: ${!!body.hayMas})`)
  const porCanal = {}
  for (const c of convs) porCanal[c.channel] = (porCanal[c.channel] ?? 0) + 1
  console.log(
    `canales: ${Object.entries(porCanal)
      .map(([k, v]) => `${k}=${v}`)
      .join(' · ')}`
  )
  console.log('\nPrimeras conversaciones (datos enmascarados; id completo para poder enviar):')
  for (const [i, c] of convs.slice(0, 40).entries()) {
    const pista = /qa|test|demo|prueba|alex|torre|scalix/i.test(c.participant || '')
      ? '  <— posible contacto controlado'
      : ''
    console.log(
      `  ${i + 1}. id=${c.id} canal=${c.channel} contactId=${c.contactId ? 'sí' : 'NO'} nombre=${enmascarar(c.participant)} msgs=${(c.messages ?? []).length}${pista}`
    )
  }
}

async function modoSend(cookie, conversationId, texto) {
  console.log(`Entorno: ${BASE} · tenant: ${slug}`)
  console.log(`POST /conversations/reply → conversación ${conversationId} (texto: ${texto.length} caracteres)`)
  const res = await fetch(`${BASE}/api/${slug}/evergreen/setting-ai/conversations/reply`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ conversationId, texto }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = await res.json().catch(() => ({}))
  console.log(`HTTP ${res.status} → ${JSON.stringify(body)}`)
  if (!res.ok || !body.ok) return

  // Read-back: la bandeja sirve el snapshot; el refresco tras el envío puede tardar unos
  // segundos, así que se sondea hasta 3 veces esperando a que GHL devuelva el mensaje nuestro.
  const sello = texto.slice(0, 60)
  for (const intento of [1, 2, 3]) {
    await sleep(intento === 1 ? 12_000 : 12_000)
    const { body: lista } = await bandeja(cookie)
    const conv = (lista.conversations ?? []).find((c) => c.id === conversationId)
    const mensajes = conv?.messages ?? []
    const nuestros = mensajes.filter((m) => m.from === 'agente' && typeof m.text === 'string' && m.text.includes(sello))
    if (nuestros.length) {
      const ultimo = mensajes[mensajes.length - 1]
      console.log(
        `CONFIRMADO en la conversación (intento ${intento}): el mensaje aparece como mensaje del equipo; total mensajes ahora: ${mensajes.length}; último del hilo: dirección=${ultimo?.from}`
      )
      return
    }
    console.log(
      `intento ${intento}: aún no visible en el snapshot (GHL aceptó el envío con messageId ${body.messageId || 's/d'})`
    )
  }
  console.log(
    'El snapshot no refleja aún el mensaje tras 3 sondeos (~36 s). El POST fue aceptado por GHL; el mensaje debería verse en el hilo al refrescar la bandeja.'
  )
}

async function modoCleanup() {
  const { data: listed } = await sbAdmin.auth.admin.listUsers({ perPage: 500 })
  const qa = (listed?.users ?? []).find((u) => u.email === EMAIL_QA)
  if (!qa) {
    console.log('No hay usuario QA que borrar.')
    return
  }
  const userId = qa.id
  const { data: borradasM } = await sbAdmin.from('tenant_members').delete().eq('user_id', userId).select('id')
  const { data: borradoU } = await sbAdmin.from('users').delete().eq('id', userId).select('id')
  const { error: aErr } = await sbAdmin.auth.admin.deleteUser(userId)
  console.log(
    `cleanup: memberships=${borradasM?.length ?? 0} · perfiles users=${borradoU?.length ?? 0} · usuario auth borrado=${aErr ? `ERROR: ${aErr.message}` : 'sí'}`
  )
  const { count: restoM } = await sbAdmin
    .from('tenant_members')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  const { count: restoU } = await sbAdmin.from('users').select('id', { count: 'exact', head: true }).eq('id', userId)
  console.log(`residuo: memberships=${restoM ?? 0} · users=${restoU ?? 0}`)
}

try {
  if (modo === 'cleanup') {
    await modoCleanup()
  } else {
    const { cookie } = await preparar()
    if (modo === 'list') await modoList(cookie)
    if (modo === 'send') {
      const conversationId = process.argv[4]
      const texto = process.argv[5]
      if (!conversationId || !texto) {
        console.error('Uso send: node scripts/sonda-inbox-envio.mjs <slug> send <conversationId> "<texto>"')
        process.exit(1)
      }
      await modoSend(cookie, conversationId, texto)
    }
  }
  console.log('\nSonda QA terminada. Ningún secreto ni dato personal ha sido impreso.')
} catch (e) {
  console.error('Sonda falló:', e.message)
  process.exit(1)
}
