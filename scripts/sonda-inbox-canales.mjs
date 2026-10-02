// SONDA QA — censo de canales de la bandeja GHL con paginación "Cargar más" (POST).
//
// Complemento de sonda-inbox-envio.mjs: el GET solo sirve el snapshot (el refresco en
// after() repite la página 1 y no avanza el cursor), así que encontrar conversaciones de
// canales concretos (SMS, WhatsApp, Instagram, Facebook) para el envío de prueba exige
// continuar el cursor con el mismo POST que usa el botón "Cargar más" de la UI.
//
//   node scripts/sonda-inbox-canales.mjs <slug> [maxPosts]
//
// POST = efecto externo con presupuesto (25 s por llamada, leer-merge-cursor en servidor,
// idempotente y reanudable): el censo puede repetirse sin duplicar ni reiniciar la bandeja.
// Seguridad: idéntica a la sonda madre — nunca imprime tokens, cookies, passwords ni datos
// personales (nombres a iniciales, emails a dominio, teléfonos a últimos 4 dígitos).
const { createClient } = await import('@supabase/supabase-js')
const { createServerClient } = await import('@supabase/ssr')
const { randomUUID } = await import('node:crypto')
const { leerEnvLocal } = await import('./env-local.mjs')

const EMAIL_QA = 'qa-inbox-envio@qa-e2e.test'
const NOMBRE_QA = 'QA Inbox Envío'

const env = leerEnvLocal()
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
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
const maxPosts = Number(process.argv[3] || 25)
if (!slug || !Number.isFinite(maxPosts) || maxPosts < 1) {
  console.error('Uso: node scripts/sonda-inbox-canales.mjs <slug> [maxPosts]')
  process.exit(1)
}

const CANALES_OBJETIVO = ['sms', 'whatsapp', 'instagram', 'facebook']

const sbAdmin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

// Enmascarado idéntico al de la sonda madre: el censo es para ELEGIR un contacto, no para leer datos.
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

async function preparar() {
  const { data: tenant, error: tErr } = await sbAdmin
    .from('tenants')
    .select('id, slug, status')
    .eq('slug', slug)
    .maybeSingle()
  if (tErr) throw new Error(`tenants: ${tErr.message}`)
  if (!tenant || tenant.status !== 'active') throw new Error(`tenant "${slug}" inexistente o inactivo`)

  const { data: cfgRows, error: cErr } = await sbAdmin
    .from('integration_settings')
    .select('key')
    .eq('tenant_id', tenant.id)
    .in('key', ['GHL_API_TOKEN', 'GHL_LOCATION_ID'])
  if (cErr) throw new Error(`integration_settings: ${cErr.message}`)
  const claves = new Set((cfgRows ?? []).map((r) => r.key))
  if (!claves.has('GHL_API_TOKEN') || !claves.has('GHL_LOCATION_ID'))
    throw new Error('el tenant no tiene credencial GHL configurada')

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
  const { data: rol } = await sbAdmin.from('roles').select('id').eq('key', 'closer').maybeSingle()
  const { error: uErr } = await sbAdmin
    .from('users')
    .upsert({ id: userId, full_name: NOMBRE_QA, email: EMAIL_QA, role_id: rol?.id ?? null, is_active: true })
  if (uErr) throw new Error(`users.upsert: ${uErr.message}`)
  const { error: mErr } = await sbAdmin
    .from('tenant_members')
    .upsert({ tenant_id: tenant.id, user_id: userId, role: 'member' }, { onConflict: 'tenant_id,user_id' })
  if (mErr) throw new Error(`tenant_members.upsert: ${mErr.message}`)

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
  return { cookie }
}

async function modoCanales(cookie) {
  console.log(`Entorno: ${BASE} · tenant: ${slug}`)
  let hayMas = true
  let posts = 0
  let total = null
  let cargadas = 0
  let corteHonesto = false
  // Cada POST devuelve el snapshot COMPLETO fusionado (no la página nueva): el censo dedupe
  // por id o contaría N veces cada conversación (una por página cargada).
  const porId = new Map() // id → conversación
  while (hayMas && posts < maxPosts) {
    const res = await fetch(`${BASE}/api/${slug}/evergreen/setting-ai/conversations?platform=ghl`, {
      method: 'POST',
      headers: { Cookie: cookie, Accept: 'application/json' },
      signal: AbortSignal.timeout(35_000),
    })
    const body = await res.json().catch(() => ({}))
    posts++
    if (!body.configured) {
      console.log(`POST ${posts}: configured:false — ${body.motivo || body.error || '(sin motivo)'}`)
      break
    }
    const convs = body.conversations ?? []
    const antes = porId.size
    for (const c of convs) porId.set(c.id, c)
    cargadas = porId.size
    total = body.total ?? total
    hayMas = !!body.hayMas
    const conteo = new Map()
    for (const c of porId.values()) conteo.set(c.channel, (conteo.get(c.channel) ?? 0) + 1)
    const objetivosFaltantes = CANALES_OBJETIVO.filter((k) => !(conteo.get(k) > 0))
    console.log(
      `POST ${posts}: únicas=${cargadas}${total ? `/${total}` : ''} hayMas=${hayMas} nuevas+${cargadas - antes} · canales: ${[
        ...conteo.entries(),
      ]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(
          ' · '
        )}${objetivosFaltantes.length ? ` (faltan: ${objetivosFaltantes.join(', ')})` : ' — objetivos completos'}`
    )
    // Sin ids nuevos = el tope de la bandeja (300 más frescas) ya contiene todo lo fusionable:
    // cargar páginas más viejas no añade nada al snapshot y solo gasta GHL.
    if (cargadas === antes) {
      console.log(`POST ${posts}: el snapshot no crece (tope de la bandeja alcanzado) — se detiene el censo.`)
      break
    }
    if (!objetivosFaltantes.length) break
  }
  if (hayMas && posts >= maxPosts) corteHonesto = true

  const porCanal = new Map()
  for (const c of porId.values()) {
    const lista = porCanal.get(c.channel) ?? []
    lista.push(c)
    porCanal.set(c.channel, lista)
  }
  console.log(
    `\nCENSO de ${cargadas}${total ? ` de ${total}` : ''} conversaciones únicas (${posts} POST de continuación):`
  )
  for (const [canal, lista] of [...porCanal.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${canal}: ${lista.length}`)
  }
  console.log('\nCandidatos en canales objetivo (id completo para poder enviar; nombre enmascarado):')
  for (const canal of CANALES_OBJETIVO) {
    const lista = porCanal.get(canal) ?? []
    if (!lista.length) {
      console.log(`  ${canal}: SIN conversaciones en lo cargado`)
      continue
    }
    // Los controlados se buscan en TODAS las conversaciones del canal, no en una muestra:
    // enviar un QA a un lead real no es aceptable, así que el criterio es exhaustivo.
    const controlados = lista.filter((c) => /qa|test|demo|prueba|alex|torre|scalix/i.test(c.participant || ''))
    if (!controlados.length) {
      console.log(
        `  ${canal}: ${lista.length} conversaciones y NINGUNA de contacto controlado (muestra de ${Math.min(3, lista.length)} leads reales, NO enviar):`
      )
      for (const c of lista.slice(0, 3)) {
        console.log(
          `    id=${c.id} contactId=${c.contactId ? 'sí' : 'NO'} nombre=${enmascarar(c.participant)} msgs=${(c.messages ?? []).length}`
        )
      }
      continue
    }
    for (const c of controlados) {
      console.log(
        `  ${canal}: id=${c.id} contactId=${c.contactId ? 'sí' : 'NO'} nombre=${enmascarar(c.participant)} msgs=${(c.messages ?? []).length}  <— contacto controlado`
      )
    }
  }
  if (corteHonesto) {
    console.log(
      `\nCORTE HONESTO: se alcanzó el tope de ${maxPosts} POST con hayMas=true — el censo puede estar incompleto (continuar con otro run: el cursor sigue en servidor).`
    )
  }
}

try {
  const { cookie } = await preparar()
  await modoCanales(cookie)
  console.log('\nSonda QA terminada. Ningún secreto ni dato personal ha sido impreso.')
} catch (e) {
  console.error('Sonda falló:', e.message)
  process.exit(1)
}
