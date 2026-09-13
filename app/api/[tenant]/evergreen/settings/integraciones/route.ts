import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { encryptSecret, invalidateConfigCache, getTenantConfigWithFallback } from '@/lib/config'
import { ALL_FIELDS, SECRET_KEYS, isKnownKey, INTEGRATION_ONLY_GROUPS } from '@/lib/integrations-catalog'
import { assessIntegration, SYNCS_BY_GROUP, type LastCheck } from '@/lib/integrations/health'
import { SYNC_DEFS } from '@/lib/ops/sync-health'
import { PG_CRON_READY, VERCEL_CRON_ROUTES } from '@/lib/ops/vercel-crons'
import { parseAccountIds, fetchAdAccounts } from '@/lib/meta/client'
import { requireTenant } from '@/lib/auth/requireTenant'
import { isDeprecatedMetaVersion, META_API_VERSION } from '@/lib/meta/api-version'

export const runtime = 'nodejs'

async function requireAdmin(
  tenantSlug: string
): Promise<{ ok: true; callerId: string; tenantId: string } | { ok: false; res: NextResponse }> {
  const t = await requireTenant(tenantSlug)
  if ('error' in t) return { ok: false, res: t.error }
  const sb = svc()
  const role = t.role
  if (role !== 'admin' && role !== 'director') {
    return { ok: false, res: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return { ok: true, callerId: t.userId, tenantId: t.tenantId }
}

function svc(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Clave donde vive el último veredicto de cada integración. Va en integration_settings (no secreta)
// porque es configuración/estado por subcuenta, que es justo lo que guarda esa tabla: no hace falta
// tabla nueva ni migración para algo que se sobrescribe entero en cada comprobación.
const HEALTH_KEY = 'INTEGRATION_HEALTH'

/** Lee el estado guardado siendo tolerante: un JSON corrupto deja las luces en gris, no rompe nada. */
function parseLastChecks(raw: string | null | undefined): Record<string, LastCheck> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, LastCheck> = {}
    for (const [group, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<LastCheck>
      if (typeof v?.ok !== 'boolean' || typeof v?.checkedAt !== 'string') continue
      out[group] = {
        ok: v.ok,
        message: typeof v.message === 'string' ? v.message : '',
        checkedAt: v.checkedAt,
        code: typeof v.code === 'string' ? v.code : undefined,
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Cuenta las filas de las tablas que alimentan las integraciones, para poder decir "conectada pero
 * todavía sin datos". `null` = no se pudo leer, que NO es 0 (ver lib/ops/sync-health).
 */
async function countSyncTables(client: SupabaseClient, tenantId: string): Promise<Record<string, number | null>> {
  const grupos = new Set(Object.values(SYNCS_BY_GROUP).flat())
  const tablas = [...new Set(SYNC_DEFS.filter((d) => grupos.has(d.id)).map((d) => d.table))]
  const out: Record<string, number | null> = {}
  await Promise.all(
    tablas.map(async (table) => {
      const { count, error } = await client
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
      out[table] = error ? null : (count ?? 0)
    })
  )
  return out
}

function mask(v: string): string {
  if (!v) return ''
  if (v.length <= 6) return '••••'
  return `••••${v.slice(-4)}`
}

// GET — estado de cada clave: configurada (BBDD), en env (fallback) o vacía.
// Nunca devuelve secretos en claro (solo máscara). Los no-secretos sí (para editarlos).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireAdmin(tenant)
  if (!auth.ok) return auth.res

  const encReady = !!process.env.CONFIG_ENC_KEY
  let dbRows: Record<string, { value: string | null; is_secret: boolean }> = {}
  try {
    const { data } = await svc()
      .from('integration_settings')
      .select('key,value,is_secret')
      .eq('tenant_id', auth.tenantId)
    for (const r of data ?? []) dbRows[(r as { key: string }).key] = r as { value: string | null; is_secret: boolean }
  } catch {
    /* tabla sin migrar */
  }

  const state: Record<string, { source: 'db' | 'env' | 'none'; secret: boolean; preview: string; value?: string }> = {}
  for (const f of ALL_FIELDS) {
    const inDb = dbRows[f.key]?.value
    const inEnv = process.env[f.key]
    if (inDb) {
      state[f.key] = f.secret
        ? { source: 'db', secret: true, preview: '••••••' }
        : { source: 'db', secret: false, preview: inDb, value: inDb }
    } else if (inEnv) {
      state[f.key] = f.secret
        ? { source: 'env', secret: true, preview: mask(inEnv) }
        : { source: 'env', secret: false, preview: inEnv, value: inEnv }
    } else {
      state[f.key] = { source: 'none', secret: f.secret, preview: '' }
    }
  }
  // Estado real de cada integración: credenciales + última comprobación contra su API + si sus
  // sincronizaciones pueden funcionar. Es lo que decide la luz verde/gris/roja, en vez de pintar
  // "conectado" por el simple hecho de que exista un token escrito.
  const lastChecks = parseLastChecks(dbRows[HEALTH_KEY]?.value)
  const facts = {
    configuredKeys: new Set(
      Object.entries(state)
        .filter(([, v]) => v.source !== 'none')
        .map(([k]) => k)
    ),
    rowCounts: await countSyncTables(svc(), auth.tenantId),
    vercelScheduled: VERCEL_CRON_ROUTES,
    pgCronReady: PG_CRON_READY,
  }
  const health = INTEGRATION_ONLY_GROUPS.map((g) =>
    assessIntegration(
      { id: g.id, required: g.required, testable: g.test === true },
      { facts, lastCheck: lastChecks[g.id] }
    )
  )

  // `groups` son los grupos pintables en Integraciones; `state` sigue cubriendo ALL_FIELDS, así
  // que Datos de empresa puede leer IG_BUSINESS_CONTEXT/IG_BRAND_ASSETS del mismo endpoint.
  return NextResponse.json({ encReady, groups: INTEGRATION_ONLY_GROUPS, state, health })
}

// POST — guardar cambios. body: { updates: { KEY: value } }.
// Secreto con valor vacío => NO se toca (para no borrar al no reescribir el campo enmascarado).
// Para BORRAR una clave: enviar { clear: ["KEY", …] }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireAdmin(tenant)
  if (!auth.ok) return auth.res

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    group?: string
    // Token recién pegado y TODAVÍA NO guardado: sirve para poder listar las cuentas antes de
    // guardar nada, que es el orden natural (pegas el token, eliges cuenta, guardas). No se
    // persiste aquí ni se escribe en ningún log.
    token?: string
    updates?: Record<string, string>
    clear?: string[]
  }

  if (body.action === 'test') return runTest(body.group || '', auth.tenantId)
  if (body.action === 'meta-accounts') return listMetaAccounts(auth.tenantId, body.token)

  const updates = body.updates || {}
  const clear = body.clear || []
  const client = svc()
  const rows: { key: string; tenant_id: string; value: string; is_secret: boolean; updated_by: string }[] = []
  const needsEnc = ALL_FIELDS.some((f) => f.secret && updates[f.key])

  if (needsEnc && !process.env.CONFIG_ENC_KEY) {
    return NextResponse.json(
      { error: 'Falta CONFIG_ENC_KEY en el entorno; no se pueden guardar secretos cifrados.' },
      { status: 400 }
    )
  }

  for (const [key, raw] of Object.entries(updates)) {
    if (!isKnownKey(key)) continue
    const val = (raw ?? '').trim()
    const secret = SECRET_KEYS.has(key)
    if (secret && val === '') continue // no reescribir secreto en blanco
    rows.push({
      key,
      tenant_id: auth.tenantId,
      value: secret ? encryptSecret(val) : val,
      is_secret: secret,
      updated_by: auth.callerId,
    })
  }

  if (rows.length) {
    // El índice único original era (key) global, lo que habría hecho que dos subcuentas guardando
    // la misma clave (p.ej. META_ACCESS_TOKEN) se pisaran entre sí.
    // 20260911160000_fix_cron_unique_constraints lo sustituyó por (tenant_id, key): VERIFICADO en
    // producción el 2026-09-13 — existe integration_settings_tenant_key_key UNIQUE (tenant_id, key)
    // y ya no hay unique global sobre `key`. (Este comentario decía "pendiente de aplicar": era
    // información obsoleta, no un pendiente real.)
    const { error } = await client.from('integration_settings').upsert(rows, { onConflict: 'tenant_id,key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (clear.length) {
    await client
      .from('integration_settings')
      .delete()
      .eq('tenant_id', auth.tenantId)
      .in('key', clear.filter(isKnownKey))
  }

  invalidateConfigCache(auth.tenantId)
  return NextResponse.json({ ok: true, saved: rows.length, cleared: clear.length })
}

// ── Probar conexión por integración ─────────────────────────────────────────

/**
 * Cuentas publicitarias que ve un token de Meta, para poder ELEGIR en vez de tener que averiguar el
 * `act_…` por tu cuenta. Acepta un token sin guardar: si el usuario tuviera que guardarlo primero,
 * guardaría uno inválido para descubrir que lo es.
 */
async function listMetaAccounts(tenantId: string, tokenSinGuardar?: string): Promise<NextResponse> {
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  const token = (tokenSinGuardar || '').trim() || cfg.META_ACCESS_TOKEN
  if (!token) {
    return NextResponse.json({ ok: false, message: 'Pega antes el token de acceso de Meta.' }, { status: 400 })
  }
  const version = cfg.META_API_VERSION || META_API_VERSION
  if (isDeprecatedMetaVersion(cfg.META_API_VERSION)) {
    return NextResponse.json(
      {
        ok: false,
        message: `La versión ${cfg.META_API_VERSION} está deprecada por Meta: bórrala en opciones avanzadas.`,
      },
      { status: 400 }
    )
  }
  try {
    const accounts = await fetchAdAccounts(token, version, cfg.META_APP_SECRET)
    if (accounts.length === 0) {
      return NextResponse.json({
        ok: false,
        message:
          'El token funciona pero no ve ninguna cuenta publicitaria. Dale el permiso ads_read sobre la cuenta en Meta Business y vuelve a buscar.',
      })
    }
    // `status` de Meta: 1 = activa. El resto (cerrada, con deuda, en revisión…) se marca para que no
    // elijas a ciegas una cuenta que no va a devolver datos.
    return NextResponse.json({
      ok: true,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name, active: a.status === 1 })),
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      message: `No se pudieron listar las cuentas: ${(e as Error).message}`,
    })
  }
}

/** Veredicto de una comprobación. `code` es una pista ESTABLE para elegir el arreglo a mostrar. */
type ProbeResult = { ok: boolean; message: string; code?: string }

/**
 * Traduce el código HTTP del proveedor a una causa. El mensaje lo escribe la API externa y cambia sin
 * avisar, así que la pantalla no puede depender de parsearlo para decir cómo arreglarlo.
 */
function codeFromStatus(status: number): string {
  if (status === 401) return 'token_invalido'
  if (status === 403) return 'sin_permisos'
  if (status === 429) return 'limite_de_uso'
  if (status >= 500) return 'red'
  return 'respuesta_inesperada'
}

/**
 * Comprueba una integración y GUARDA el resultado, que es lo que alimenta la luz de la pantalla.
 * Si no se guardara, la pantalla volvería a pintar "conectado" por tener un token escrito.
 */
async function runTest(group: string, tenantId: string): Promise<NextResponse> {
  const result = await probeGroup(group, tenantId)
  await saveLastCheck(tenantId, group, result)
  return NextResponse.json({ ...result, checkedAt: new Date().toISOString() })
}

/** Historial mínimo por integración: el último veredicto y cuándo se obtuvo. */
async function saveLastCheck(tenantId: string, group: string, result: ProbeResult): Promise<void> {
  if (!group) return
  const client = svc()
  const { data } = await client
    .from('integration_settings')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', HEALTH_KEY)
    .maybeSingle()
  const current = parseLastChecks((data as { value: string | null } | null)?.value)
  current[group] = { ok: result.ok, message: result.message, code: result.code, checkedAt: new Date().toISOString() }
  // Un fallo al guardar el estado NO puede tumbar la comprobación: el usuario ya tiene su respuesta,
  // y como máximo la luz seguirá gris ("sin comprobar"), que es lo honesto si no se pudo registrar.
  await client
    .from('integration_settings')
    .upsert(
      {
        tenant_id: tenantId,
        key: HEALTH_KEY,
        value: JSON.stringify(current),
        is_secret: false,
        label: 'Último resultado de comprobación por integración',
      },
      { onConflict: 'tenant_id,key' }
    )
    .select('key')
}

function metaProof(token: string, appSecret?: string): string {
  if (!appSecret) return ''
  return crypto.createHmac('sha256', appSecret).update(token).digest('hex')
}

// Habla con la API de cada integración y devuelve un veredicto en claro.
//
// Devuelve datos, no una respuesta HTTP, por dos motivos: el resultado se GUARDA (es lo que alimenta
// la luz verde/gris/roja de la pantalla, que sin esto pintaría "conectado" por tener un token
// escrito), y así se puede probar la clasificación sin montar un servidor.
async function probeGroup(group: string, tenantId: string): Promise<ProbeResult> {
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  try {
    if (group === 'meta') {
      const token = cfg.META_ACCESS_TOKEN
      if (!token) return { ok: false, message: 'Falta el token de Meta.' }
      const ver = cfg.META_API_VERSION || META_API_VERSION
      // Meta retira versiones por calendario, no cuando te va mal: una subcuenta que fijó una
      // versión hace un año se entera de que está deprecada el día que dejan de responderle. Aquí se
      // avisa antes, aunque el token sea perfecto.
      if (isDeprecatedMetaVersion(cfg.META_API_VERSION)) {
        return {
          ok: false,
          message: `La versión de la API fijada en esta subcuenta (${cfg.META_API_VERSION}) está deprecada por Meta.`,
          code: 'version_deprecada',
        }
      }
      const proof = metaProof(token, cfg.META_APP_SECRET)
      const proofQs = proof ? `&appsecret_proof=${proof}` : ''
      const accounts = parseAccountIds(cfg.META_AD_ACCOUNT_ID)
      // Sin cuentas explícitas → modo "todas": descubrir las accesibles por el token.
      if (accounts.length === 0) {
        try {
          const all = await fetchAdAccounts(token, ver, cfg.META_APP_SECRET)
          if (all.length === 0) {
            return {
              ok: false,
              message: 'El token es válido pero no ve ninguna cuenta publicitaria.',
              code: 'sin_cuentas',
            }
          }
          return {
            ok: true,
            message: `${all.length} cuenta(s) detectada(s): ${all.map((a) => a.name).join(', ')}`,
          }
        } catch (e) {
          return {
            ok: false,
            message: `No se pudieron listar las cuentas: ${(e as Error).message}`,
            code: 'token_invalido',
          }
        }
      }
      // Probar cada cuenta explícita; reportar OK solo si todas responden.
      const results = await Promise.all(
        accounts.map(async (acc) => {
          const url = `https://graph.facebook.com/${ver}/${acc}?fields=name,account_status&access_token=${encodeURIComponent(token)}${proofQs}`
          const r = await fetch(url)
          const j = await r.json()
          return { acc, ok: r.ok, name: j.name as string | undefined, err: j.error?.message as string | undefined }
        })
      )
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        return {
          ok: false,
          message: `Fallo en ${failed.map((f) => f.acc).join(', ')}: ${failed[0].err || 'Error de Meta'}`,
          code: 'token_invalido',
        }
      }
      const names = results.map((r) => r.name || r.acc)
      return {
        ok: true,
        message: results.length === 1 ? `Cuenta: ${names[0]}` : `${results.length} cuentas OK: ${names.join(', ')}`,
      }
    }
    if (group === 'instagram') {
      const token = cfg.INSTAGRAM_ACCESS_TOKEN || cfg.META_ACCESS_TOKEN
      if (!token) return { ok: false, message: 'Falta el token de Instagram/Meta.' }
      const ver = cfg.META_API_VERSION || META_API_VERSION
      const proof = metaProof(token, cfg.META_APP_SECRET)
      const url = `https://graph.facebook.com/${ver}/me/accounts?fields=name&access_token=${encodeURIComponent(token)}${proof ? `&appsecret_proof=${proof}` : ''}`
      const r = await fetch(url)
      const j = await r.json()
      return r.ok
        ? { ok: true, message: 'Token válido.' }
        : { ok: false, message: j.error?.message || 'Error de Instagram', code: codeFromStatus(r.status) }
    }
    if (group === 'calendly') {
      const token = cfg.CALENDLY_API_TOKEN
      if (!token) return { ok: false, message: 'Falta el PAT de Calendly.' }
      const r = await fetch('https://api.calendly.com/users/me', { headers: { Authorization: `Bearer ${token}` } })
      const j = await r.json()
      return r.ok
        ? { ok: true, message: `Usuario: ${j.resource?.name || 'OK'}` }
        : { ok: false, message: j.message || 'Token inválido', code: codeFromStatus(r.status) }
    }
    if (group === 'fathom') {
      const key = cfg.FATHOM_API_KEY
      if (!key) return { ok: false, message: 'Falta la API key de Fathom.' }
      const r = await fetch('https://api.fathom.ai/external/v1/meetings?limit=1', {
        headers: { 'X-Api-Key': key, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      const j = (await r.json().catch(() => ({}))) as { items?: unknown[]; message?: string; error?: string }
      return r.ok
        ? {
            ok: true,
            message: `Fathom conectado; ${j.items?.length ? 'hay reuniones accesibles.' : 'sin reuniones accesibles todavía.'}`,
          }
        : {
            ok: false,
            message: j.message || j.error || `Fathom respondió ${r.status}.`,
            code: codeFromStatus(r.status),
          }
    }
    if (group === 'email') {
      const key = cfg.RESEND_API_KEY
      if (!key) return { ok: false, message: 'Falta la API key de Resend.' }
      const from = cfg.RESEND_FROM || ''
      const fromDomain = from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() || null
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } })
      if (r.ok) {
        const j = (await r.json().catch(() => ({}))) as { data?: { name: string; status: string }[] }
        const domains = j.data ?? []
        const verified = domains.filter((d) => d.status === 'verified').map((d) => d.name.toLowerCase())
        if (!fromDomain) {
          return {
            ok: false,
            message: `Falta configurar el remitente (RESEND_FROM). Dominios verificados: ${verified.join(', ') || 'ninguno'}.`,
          }
        }
        if (!verified.includes(fromDomain)) {
          return {
            ok: false,
            message: `La API key es válida, pero el dominio "${fromDomain}" del remitente no está verificado. Dominios verificados: ${verified.join(', ') || 'ninguno'}.`,
            code: 'dominio_no_verificado',
          }
        }
        return { ok: true, message: `Conexión correcta. Dominio "${fromDomain}" verificado.` }
      }
      // Key de tipo "solo envío": no tiene permiso para listar dominios (401 restricted_api_key).
      // Sigue siendo válida para enviar, así que hacemos una comprobación real intentando un envío
      // de prueba sin destinatario válido para que Resend nos diga si el dominio está verificado.
      const j = (await r.json().catch(() => ({}))) as { name?: string }
      if (r.status === 401 && j?.name === 'restricted_api_key') {
        const probe = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: from || 'onboarding@resend.dev',
            to: ['verificacion@resend.dev'],
            subject: 'ping',
            html: '<p>ping</p>',
          }),
        })
        const pj = (await probe.json().catch(() => ({}))) as { message?: string; name?: string }
        if (probe.ok)
          return {
            ok: true,
            message: `Conexión correcta (key de solo envío). Remitente "${fromDomain || from}".`,
          }
        if (/not verified/i.test(pj.message || '')) {
          return {
            ok: false,
            message: `El dominio "${fromDomain}" del remitente NO está verificado en Resend.`,
            code: 'dominio_no_verificado',
          }
        }
        return { ok: false, message: pj.message || 'No se pudo enviar el correo de prueba.' }
      }
      return { ok: false, message: 'API key inválida.', code: 'token_invalido' }
    }
    if (group === 'stripe') {
      const key = cfg.STRIPE_SECRET_KEY
      if (!key) return { ok: false, message: 'Falta la Secret Key de Stripe.' }
      const r = await fetch('https://api.stripe.com/v1/payment_intents?limit=1', {
        headers: {
          Authorization: `Bearer ${key}`,
          ...(cfg.STRIPE_ACCOUNT_ID ? { 'Stripe-Account': cfg.STRIPE_ACCOUNT_ID } : {}),
        },
      })
      const j = (await r.json().catch(() => ({}))) as { data?: unknown[]; error?: { message?: string } }
      return r.ok
        ? {
            ok: true,
            message: `Stripe conectado; acceso de lectura de pagos confirmado${j.data?.length ? '.' : ' (sin pagos todavía).'}`,
          }
        : { ok: false, message: j.error?.message || 'No se pudo conectar con Stripe.', code: codeFromStatus(r.status) }
    }
    if (group === 'ghl') {
      const token = cfg.GHL_API_TOKEN
      const locationId = cfg.GHL_LOCATION_ID
      if (!token || !locationId) return { ok: false, message: 'Faltan el token o el Location ID de GoHighLevel.' }
      const r = await fetch(`https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId)}`, {
        headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
      })
      const j = (await r.json().catch(() => ({}))) as { location?: { name?: string }; message?: string }
      return r.ok
        ? { ok: true, message: `Subcuenta ${j.location?.name || locationId} conectada.` }
        : { ok: false, message: j.message || `GoHighLevel respondió ${r.status}.`, code: codeFromStatus(r.status) }
    }
    if (group === 'hotmart') {
      if (!cfg.HOTMART_CLIENT_ID || !cfg.HOTMART_CLIENT_SECRET) {
        return { ok: false, message: 'Faltan el Client ID o el Client Secret de Hotmart.' }
      }
      const query = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: cfg.HOTMART_CLIENT_ID,
        client_secret: cfg.HOTMART_CLIENT_SECRET,
      })
      const r = await fetch(`https://api-sec-vlc.hotmart.com/security/oauth/token?${query}`, { method: 'POST' })
      const j = (await r.json().catch(() => ({}))) as { error_description?: string; access_token?: string }
      return r.ok && j.access_token
        ? { ok: true, message: 'Credenciales de Hotmart válidas.' }
        : { ok: false, message: j.error_description || 'Client ID o Secret inválidos.', code: 'token_invalido' }
    }
    if (group === 'whop') {
      if (!cfg.WHOP_API_KEY) return { ok: false, message: 'Falta la API Key de Whop.' }
      const r = await fetch('https://api.whop.com/api/v2/me', {
        headers: { Authorization: `Bearer ${cfg.WHOP_API_KEY}` },
      })
      const j = (await r.json().catch(() => ({}))) as { message?: string }
      return r.ok
        ? { ok: true, message: 'API Key de Whop válida.' }
        : { ok: false, message: j.message || `Whop respondió ${r.status}.`, code: codeFromStatus(r.status) }
    }
    if (group === 'ai') {
      const missing = [!cfg.ANTHROPIC_API_KEY && 'Anthropic', !cfg.GROQ_API_KEY && 'Groq'].filter(Boolean)
      if (missing.length) return { ok: false, message: `Falta configurar: ${missing.join(', ')}.` }
      const [anthropic, groq] = await Promise.all([
        fetch('https://api.anthropic.com/v1/models?limit=1', {
          headers: { 'x-api-key': cfg.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        }),
        fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${cfg.GROQ_API_KEY}` } }),
      ])
      if (!anthropic.ok || !groq.ok) {
        return {
          ok: false,
          message: `Anthropic: ${anthropic.ok ? 'OK' : anthropic.status}; Groq: ${groq.ok ? 'OK' : groq.status}.`,
        }
      }
      return { ok: true, message: 'Anthropic y Groq conectados.' }
    }
    if (group === 'deepseek') {
      const key = cfg.DEEPSEEK_API_KEY
      if (!key) return NextResponse.json({ ok: false, message: 'Falta la API key de DeepSeek.' })

      const r = await fetch('https://api.deepseek.com/models', {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      })
      const j = (await r.json().catch(() => ({}))) as {
        data?: Array<{ id?: string }>
        error?: { message?: string }
      }
      if (!r.ok) {
        const reason =
          r.status === 401
            ? 'La API key no es válida.'
            : r.status === 402
              ? 'La cuenta de DeepSeek no tiene saldo disponible.'
              : r.status === 429
                ? 'DeepSeek ha limitado temporalmente las solicitudes. Inténtalo de nuevo en unos minutos.'
                : j.error?.message || `DeepSeek respondió ${r.status}.`
        return NextResponse.json({ ok: false, message: reason })
      }

      const configuredModel = cfg.DEEPSEEK_MODEL || 'deepseek-v4-flash'
      const models = (j.data ?? []).map((model) => model.id).filter((id): id is string => Boolean(id))
      const modelAvailable = models.length === 0 || models.includes(configuredModel)
      return NextResponse.json({
        ok: modelAvailable,
        message: modelAvailable
          ? `DeepSeek conectado. Modelo predeterminado: ${configuredModel}.`
          : `La conexión funciona, pero el modelo ${configuredModel} no está disponible para esta cuenta.`,
      })
    }
    if (group === 'youtube') {
      if (!cfg.YOUTUBE_CLIENT_ID || !cfg.YOUTUBE_CLIENT_SECRET || !cfg.YOUTUBE_REFRESH_TOKEN) {
        return { ok: false, message: 'Faltan credenciales OAuth de YouTube.' }
      }
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.YOUTUBE_CLIENT_ID,
          client_secret: cfg.YOUTUBE_CLIENT_SECRET,
          refresh_token: cfg.YOUTUBE_REFRESH_TOKEN,
          grant_type: 'refresh_token',
        }),
      })
      const j = (await r.json().catch(() => ({}))) as { error_description?: string }
      return r.ok
        ? { ok: true, message: 'OAuth de YouTube válido.' }
        : { ok: false, message: j.error_description || 'Credenciales OAuth inválidas.', code: 'token_invalido' }
    }
    if (group === 'sequra') {
      if (!cfg.SEQURA_MCP_TOKEN) return { ok: false, message: 'Falta el token MCP de SeQura.' }
      const r = await fetch('https://simba.sequra.com/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          Authorization: `Bearer ${cfg.SEQURA_MCP_TOKEN}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list', params: {} }),
      })
      return r.ok
        ? { ok: true, message: 'SeQura conectado.' }
        : {
            ok: false,
            message: `SeQura respondió ${r.status}; renueva el token si ha caducado.`,
            code: codeFromStatus(r.status),
          }
    }
    if (group === 'creatuagente') {
      if (!cfg.CREATUAGENTE_WEBHOOK_URL || !cfg.CREATUAGENTE_WEBHOOK_SECRET) {
        return { ok: false, message: 'Faltan la URL o el secreto del webhook.' }
      }
      try {
        new URL(cfg.CREATUAGENTE_WEBHOOK_URL)
      } catch {
        return { ok: false, message: 'La URL del webhook no es válida.' }
      }
      return { ok: true, message: 'Configuración válida. No se envió ningún evento de prueba.' }
    }
    return { ok: false, message: 'Esta integración no tiene prueba automática.' }
  } catch (e) {
    // Un fallo de red NO es una credencial inválida: decirlo así mandaría al usuario a rotar un
    // token que está perfecto.
    return { ok: false, message: `No se pudo hablar con la API: ${(e as Error).message}`, code: 'red' }
  }
}
