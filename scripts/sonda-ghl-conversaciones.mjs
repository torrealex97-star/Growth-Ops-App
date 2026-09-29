// SONDA DE SOLO-LECTURA — verificación en vivo de la pestaña GHL de Conversaciones (petición de Alex).
//
// Qué hace:
//   1. Lee GHL_API_TOKEN/GHL_LOCATION_ID de integration_settings (descifrado en memoria con
//      CONFIG_ENC_KEY de .env.local — NUNCA se imprime un secreto, ni completo ni truncado).
//   2. Llama a GET /conversations/search de GHL con los mismos parámetros que la ruta de producción.
//   3. Resume formas y claves de la respuesta (firma de campo, no valores: cero PII).
//   4. Repite la sonda contra el tenant que elija Alex con un argumento opcional (slug); por defecto
//      escanea las subcuentas activas y prueba TODAS las que tengan credencial GHL.
//
// Si el mapeo diverge de lo asumido (p.ej. unreadCount anidado, lastMessageDate con otro nombre),
// el resumen de claves lo delata sin necesidad de ver datos. Uso: node scripts/sonda-ghl-conversaciones.mjs
const { createClient } = await import('@supabase/supabase-js')
const { leerEnvLocal } = await import('./env-local.mjs')
const { createDecipheriv, createHash } = await import('node:crypto')

const env = leerEnvLocal()
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
const encKeyEnv = process.env.CONFIG_ENC_KEY || env.CONFIG_ENC_KEY
if (!url || !key || !encKeyEnv) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / CONFIG_ENC_KEY en .env.local')
  process.exit(1)
}

const ENCP = 'enc:v1:'
function descifrar(stored) {
  if (!stored?.startsWith(ENCP)) return stored
  const k = createHash('sha256').update(encKeyEnv, 'utf8').digest()
  const raw = Buffer.from(stored.slice(ENCP.length), 'base64')
  const d = createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12))
  d.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')
}

const sb = createClient(url, key)

// No imprime NUNCA el valor: solo si existe y con qué forma (tipo / nº de claves / tamaño).
function huella(valor) {
  if (valor == null) return 'null'
  if (typeof valor !== 'object') return typeof valor
  if (Array.isArray(valor)) return `array(${valor.length})`
  return Object.keys(valor).length ? `objeto(${Object.keys(valor).length} claves)` : 'objeto vacío'
}

async function main() {
  // 1. Tenants activos (y el filtro opcional por slug si Alex pasa uno).
  const slugFiltro = process.argv[2] || null
  const q = sb.from('tenants').select('id, slug, name').eq('status', 'active').order('name')
  const { data: tenants, error: tErr } = slugFiltro
    ? await q.eq('slug', slugFiltro)
    : await q
  if (tErr) throw new Error(`tenants: ${tErr.message}`)
  console.log(`Subcuentas activas: ${tenants.length}${slugFiltro ? ` (filtro slug=${slugFiltro})` : ''}`)

  for (const t of tenants) {
    // 2. Credencial GHL (sin valores en el log).
    const { data: cfg, error: cErr } = await sb
      .from('integration_settings')
      .select('key,value,is_secret')
      .eq('tenant_id', t.id)
      .in('key', ['GHL_API_TOKEN', 'GHL_LOCATION_ID'])
    if (cErr) {
      console.log(`\n[${t.slug}] integration_settings ilegible: ${cErr.message}`)
      continue
    }
    const ghlToken = cfg?.find((r) => r.key === 'GHL_API_TOKEN')
    const ghlLoc = cfg?.find((r) => r.key === 'GHL_LOCATION_ID')
    if (!ghlToken?.value || !ghlLoc?.value) {
      console.log(`\n[${t.slug}] sin credencial GHL (token: ${!!ghlToken?.value}, location: ${!!ghlLoc?.value})`)
      continue
    }
    let token
    try {
      token = descifrar(ghlToken.value)
      if (!token || token === ghlToken.value) throw new Error('descifrado vacío')
    } catch (e) {
      console.log(`\n[${t.slug}] GHL_API_TOKEN presente pero NO descifrable con CONFIG_ENC_KEY local: ${e.message}`)
      continue
    }
    console.log(`\n[${t.slug}] credencial GHL presente (${ghlToken.is_secret ? 'cifrada' : 'en claro'}) — probando API…`)

    // 3. GET /conversations/search, mismos parámetros que la ruta en producción.
    const u = new URL('https://services.leadconnectorhq.com/conversations/search')
    u.searchParams.set('locationId', ghlLoc.value)
    u.searchParams.set('limit', '20')
    u.searchParams.set('sortBy', 'last_message_date')
    u.searchParams.set('sort', 'desc')
    const res = await fetch(u, {
      headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    const body = await res.json().catch(() => ({}))
    console.log(`HTTP ${res.status}${res.ok ? '' : ` — ${body.message || 'sin mensaje'}`}`)
    if (!res.ok) continue

    const convs = body.conversations ?? []
    console.log(`conversaciones: ${convs.length} (total declarado: ${body.total ?? 's/d'})`)

    // 4. Firma de campos: nombres de clave + forma (tipo), jamás valores.
    const firma = {}
    for (const c of convs) {
      for (const [k, v] of Object.entries(c)) {
        const forma = huella(v)
        firma[k] = firma[k] ? (firma[k] === forma ? forma : `${firma[k]} | ${forma}`) : forma
      }
    }
    console.log('claves de cada conversación (nombre: forma):')
    for (const k of Object.keys(firma).sort()) console.log(`  - ${k}: ${firma[k]}`)

    // 5. Claves de mensajes de la primera conversación (la otra llamada que hace la ruta).
    const firstId = convs[0]?.id
    if (firstId) {
      const resM = await fetch(`https://services.leadconnectorhq.com/conversations/${encodeURIComponent(firstId)}/messages?limit=50`, {
        headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
        signal: AbortSignal.timeout(20_000),
      })
      const bodyM = await resM.json().catch(() => ({}))
      console.log(`mensajes HTTP ${resM.status}`)
      const wm = bodyM.messages ?? {}
      const lista = Array.isArray(wm) ? wm : (wm.messages ?? [])
      console.log(`mensajes: ${lista.length} (nextPage: ${wm.nextPage ?? 's/d'})`)
      if (lista.length) {
        const firmaM = {}
        for (const m of lista) {
          for (const [k, v] of Object.entries(m)) {
            const forma = huella(v)
            firmaM[k] = firmaM[k] ? (firmaM[k] === forma ? forma : `${firmaM[k]} | ${forma}`) : forma
          }
        }
        console.log('claves de cada mensaje (nombre: forma):')
        for (const k of Object.keys(firmaM).sort()) console.log(`  - ${k}: ${firmaM[k]}`)
      }
    }
  }
  console.log('\nSonda de solo-lectura terminada. Ningún dato de conversación ha sido impreso.')
}

main().catch((e) => {
  console.error('Sonda falló:', e.message)
  process.exit(1)
})
