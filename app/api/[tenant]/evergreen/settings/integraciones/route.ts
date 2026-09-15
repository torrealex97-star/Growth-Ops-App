import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { decryptSecret, encryptSecret, invalidateConfigCache, getTenantConfigWithFallback } from '@/lib/config'
import { ALL_FIELDS, SECRET_KEYS, isKnownKey, INTEGRATION_ONLY_GROUPS } from '@/lib/integrations-catalog'
import { assessIntegration, SYNCS_BY_GROUP, type LastCheck } from '@/lib/integrations/health'
import { SYNC_DEFS } from '@/lib/ops/sync-health'
import { lastRunsByJob } from '@/lib/integrations/sync-runs'
import { PG_CRON_READY, VERCEL_CRON_ROUTES } from '@/lib/ops/vercel-crons'
import { parseAccountIds, fetchAdAccounts } from '@/lib/meta/client'
import { requireTenant } from '@/lib/auth/requireTenant'
import { isDeprecatedMetaVersion, META_API_VERSION } from '@/lib/meta/api-version'
import { classifyMetaError } from '@/lib/meta/errors'
import { stripeGet } from '@/lib/stripe/client'
import { listarModelos, ModelosError, resolverModelo } from '@/lib/ai/modelos'
import { DEEPSEEK_MODELOS_PREFERIDOS } from '@/lib/ai/provider'

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

/** Longitud del secreto ya descifrado. Si no se puede descifrar, no se inventa un número. */
function decryptedLength(stored: string): number | undefined {
  try {
    return decryptSecret(stored).length
  } catch {
    return undefined
  }
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

  // `length` acompaña a los secretos: una longitud NO es una credencial, y es lo único que permite
  // ver de un vistazo que un token se pegó a medias — el fallo que Meta reporta como "Bad signature"
  // y que la máscara ••••1234 esconde por completo.
  const state: Record<
    string,
    { source: 'db' | 'env' | 'none'; secret: boolean; preview: string; value?: string; length?: number }
  > = {}
  for (const f of ALL_FIELDS) {
    const inDb = dbRows[f.key]?.value
    const inEnv = process.env[f.key]
    if (inDb) {
      state[f.key] = f.secret
        ? { source: 'db', secret: true, preview: '••••••', length: decryptedLength(inDb) }
        : { source: 'db', secret: false, preview: inDb, value: inDb }
    } else if (inEnv) {
      state[f.key] = f.secret
        ? { source: 'env', secret: true, preview: mask(inEnv), length: inEnv.length }
        : { source: 'env', secret: false, preview: inEnv, value: inEnv }
    } else {
      state[f.key] = { source: 'none', secret: f.secret, preview: '' }
    }
  }
  // Estado real de cada integración: credenciales + última comprobación contra su API + si sus
  // sincronizaciones pueden funcionar. Es lo que decide la luz verde/gris/roja, en vez de pintar
  // "conectado" por el simple hecho de que exista un token escrito.
  const lastChecks = parseLastChecks(dbRows[HEALTH_KEY]?.value)
  const [rowCounts, lastRuns] = await Promise.all([
    countSyncTables(svc(), auth.tenantId),
    // Última ejecución de cada sincronización: es lo que convierte "la tabla está vacía" en "la
    // última sincronización falló por esto". Sin esto el panel mandaba a "revisar el último error
    // del sync" sin que ese error se guardara en ninguna parte.
    lastRunsByJob(svc(), auth.tenantId),
  ])
  const facts = {
    configuredKeys: new Set(
      Object.entries(state)
        .filter(([, v]) => v.source !== 'none')
        .map(([k]) => k)
    ),
    rowCounts,
    vercelScheduled: VERCEL_CRON_ROUTES,
    pgCronReady: PG_CRON_READY,
    lastRuns,
  }
  const health = INTEGRATION_ONLY_GROUPS.map((g) =>
    assessIntegration(
      { id: g.id, required: g.required, testable: g.test === true },
      { facts, lastCheck: lastChecks[g.id] }
    )
  )

  // `groups` son los grupos pintables en Integraciones; `state` sigue cubriendo ALL_FIELDS, así
  // que Datos de empresa puede leer IG_BUSINESS_CONTEXT/IG_BRAND_ASSETS del mismo endpoint.
  return NextResponse.json({ encReady, groups: INTEGRATION_ONLY_GROUPS, state, health, runs: lastRuns })
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
  if (body.action === 'ia-modelos') return listarModelosIa(auth.tenantId, body.token)

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
  // Borrar de verdad: se cuentan las filas borradas en vez de dar por hecho que se fueron (una
  // escritura bloqueada por RLS afecta a 0 filas SIN error). Ya no hace falta retirar nada de
  // process.env: `ensureConfig` —lo que volcaba las credenciales ahí y hacía que un secreto borrado
  // siguiera vivo el resto de la vida de la lambda— se ha eliminado; ahora la configuración se pasa
  // como argumento a cada integración.
  let cleared: string[] = []
  const clearable = clear.filter(isKnownKey)
  if (clearable.length) {
    const { data: deleted, error: delErr } = await client
      .from('integration_settings')
      .delete()
      .eq('tenant_id', auth.tenantId)
      .in('key', clearable)
      .select('key')
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
    cleared = (deleted ?? []).map((r) => (r as { key: string }).key)
  }

  invalidateConfigCache(auth.tenantId)
  // Una clave que sigue en el entorno de Vercel no se puede borrar desde aquí: decirlo es lo único
  // honesto, porque el valor seguirá usándose como fallback.
  const enEntorno = clearable.filter((k) => !!process.env[k])
  return NextResponse.json({
    ok: true,
    saved: rows.length,
    cleared: cleared.length,
    clearedKeys: cleared,
    stillInEnv: enEntorno,
  })
}

// ── Probar conexión por integración ─────────────────────────────────────────

/**
 * Cuentas publicitarias que ve un token de Meta, para poder ELEGIR en vez de tener que averiguar el
 * `act_…` por tu cuenta. Acepta un token sin guardar: si el usuario tuviera que guardarlo primero,
 * guardaría uno inválido para descubrir que lo es.
 */
// Los modelos que la cuenta puede usar DE VERDAD, preguntándoselos al proveedor. Mismo patrón que
// "Buscar cuentas" de Meta: sin esto el modelo se escribía a mano y una errata —o un modelo que el
// proveedor retira— dejaba la IA muerta sin que el panel dijera nada.
async function listarModelosIa(tenantId: string, claveSinGuardar?: string): Promise<NextResponse> {
  const cfg = await getTenantConfigWithFallback(tenantId, true)
  const clave = (claveSinGuardar || '').trim() || cfg.DEEPSEEK_API_KEY
  if (!clave) {
    return NextResponse.json({ ok: false, message: 'Pega antes la clave de API de DeepSeek.' }, { status: 400 })
  }
  try {
    const modelos = await listarModelos(clave)
    const { modelo, aviso } = resolverModelo(cfg.DEEPSEEK_MODEL, modelos, DEEPSEEK_MODELOS_PREFERIDOS)
    return NextResponse.json({ ok: true, modelos, sugerido: modelo, aviso })
  } catch (e) {
    const err = e instanceof ModelosError ? e : null
    return NextResponse.json(
      { ok: false, code: err?.code, message: err?.message ?? 'No se pudieron leer los modelos.' },
      { status: err?.code === 'token_invalido' ? 400 : 502 }
    )
  }
}

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
      code: (e as { code?: string }).code,
      message: `No se pudieron listar las cuentas: ${(e as Error).message}`,
    })
  }
}

/**
 * ¿Conecta Meta sin firmar? Se usa cuando la firma `appsecret_proof` falla, para poder decir si el
 * problema es SOLO el App Secret guardado.
 *
 * Meta exige la firma únicamente si la app tiene activado "Require app secret". Si sin firma responde
 * bien, la app NO la exige y el secreto guardado es basura que sobra; si sin firma también falla, hay
 * algo más (token, permisos) y decir "borra el secreto" sería mandar al sitio equivocado. Es la
 * diferencia entre diagnosticar y adivinar.
 */
async function metaConectaSinFirma(token: string, version: string): Promise<boolean> {
  try {
    const r = await fetch(
      `https://graph.facebook.com/${version}/me/adaccounts?limit=1&access_token=${encodeURIComponent(token.trim())}`,
      { signal: AbortSignal.timeout(15_000) }
    )
    const j = (await r.json().catch(() => ({}))) as { error?: unknown }
    return r.ok && !j.error
  } catch {
    return false
  }
}

/** Veredicto de una comprobación. `code` es una pista ESTABLE para elegir el arreglo a mostrar. */
type ProbeResult = { ok: boolean; message: string; code?: string }

const PROBE_TIMEOUT_MS = 10_000

/** Evita que una API externa deje abierta una función de Vercel hasta agotar todo su presupuesto. */
function probeFetch(input: Parameters<typeof fetch>[0], init: RequestInit = {}) {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(PROBE_TIMEOUT_MS) })
}

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
  // Se recortan los dos: un espacio o un salto de línea pegados al copiar rompen la firma y Meta
  // responde "Invalid appsecret_proof", que no señala en absoluto a un espacio invisible.
  const secret = appSecret?.trim()
  if (!secret) return ''
  return crypto.createHmac('sha256', secret).update(token.trim()).digest('hex')
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
      // Si hay App Secret guardado, se comprueba ANTES que la firma que produce sea válida: es el
      // fallo que más veces bloquea esta integración, y disfrazado de "cuenta desconocida".
      if (proof) {
        const conFirma = await fetch(
          `https://graph.facebook.com/${ver}/me/adaccounts?limit=1&access_token=${encodeURIComponent(token.trim())}${proofQs}`,
          { signal: AbortSignal.timeout(15_000) }
        )
        const cuerpo = (await conFirma.json().catch(() => ({}))) as { error?: { message?: string } }
        if (/appsecret_proof/i.test(cuerpo.error?.message || '')) {
          const sinFirma = await metaConectaSinFirma(token, ver)
          return {
            ok: false,
            code: 'proof_invalido',
            message: sinFirma
              ? 'El App Secret guardado no es el de la app que generó el token. Sin él la conexión SÍ funciona: tu app de Meta no exige la firma, así que bórralo con el botón "Borrar" que hay junto al campo.'
              : 'El App Secret guardado no corresponde a la app que generó el token, y sin él Meta tampoco acepta el token: pega el App Secret de la MISMA app desde la que generaste el token.',
          }
        }
      }

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
          // El código lo pone el clasificador (lib/meta/errors.ts). Fijarlo a 'token_invalido' hacía
          // que un rate limit o una firma mal calculada propusieran "genera un token nuevo".
          return {
            ok: false,
            message: `No se pudieron listar las cuentas: ${(e as Error).message}`,
            code: (e as { code?: string }).code || 'respuesta_inesperada',
          }
        }
      }
      // Probar cada cuenta explícita; reportar OK solo si todas responden.
      const results = await Promise.all(
        accounts.map(async (acc) => {
          const url = `https://graph.facebook.com/${ver}/${acc}?fields=name,account_status&access_token=${encodeURIComponent(token)}${proofQs}`
          const r = await probeFetch(url)
          const j = await r.json()
          return { acc, ok: r.ok && !j.error, name: j.name as string | undefined, body: j, status: r.status }
        })
      )
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        // El código de Meta dice si es el token, el permiso o el id de cuenta: tres arreglos
        // distintos que antes se resumían todos en "token_invalido".
        const causa = classifyMetaError(failed[0].body, failed[0].status)
        return {
          ok: false,
          message: `Cuenta ${failed.map((f) => f.acc).join(', ')}: ${causa.message}`,
          code: causa.code,
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
      const qs = `&access_token=${encodeURIComponent(token.trim())}${proof ? `&appsecret_proof=${proof}` : ''}`
      // Se comprueba la CUENTA que se va a sincronizar (IG_USER_ID), no solo que el token exista.
      // Antes bastaba con que `/me/accounts` respondiera: con un IG_USER_ID equivocado la pantalla
      // decía "Token válido" y luego no llegaba ni una publicación, sin que nadie supiera por qué.
      const objetivo = cfg.IG_USER_ID
        ? `${encodeURIComponent(cfg.IG_USER_ID.trim())}?fields=username,media_count`
        : `me/accounts?fields=name`
      const r = await probeFetch(`https://graph.facebook.com/${ver}/${objetivo}${qs}`)
      const j = (await r.json()) as { username?: string; media_count?: number; error?: unknown }
      if (!r.ok || j.error) {
        const causa = classifyMetaError(j, r.status)
        return { ok: false, message: causa.message, code: causa.code }
      }
      return {
        ok: true,
        message: j.username
          ? `Cuenta @${j.username} conectada (${j.media_count ?? 0} publicaciones).`
          : 'El token vale, pero falta IG_USER_ID: sin él no se sabe qué cuenta sincronizar.',
      }
    }
    if (group === 'calendly') {
      const token = cfg.CALENDLY_API_TOKEN
      if (!token) return { ok: false, message: 'Falta el PAT de Calendly.' }
      const r = await probeFetch('https://api.calendly.com/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      })
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
      const r = await probeFetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${key}` },
      })
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
        const probe = await probeFetch('https://api.resend.com/emails', {
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
      // Por `stripeGet` y no por un fetch a pelo: así esta comprobación tiene timeout (la anterior no
      // tenía ninguno: con Stripe colgado, la pantalla se quedaba esperando) y el error llega ya
      // traducido a una causa con arreglo en vez de en inglés para desarrolladores.
      try {
        const j = await stripeGet<{ data?: unknown[] }>('payment_intents', new URLSearchParams({ limit: '1' }), {
          secretKey: key,
          accountId: cfg.STRIPE_ACCOUNT_ID,
        })
        return {
          ok: true,
          message: `Stripe conectado; acceso de lectura de pagos confirmado${j.data?.length ? '.' : ' (sin pagos todavía).'}`,
        }
      } catch (e) {
        return {
          ok: false,
          message: e instanceof Error ? e.message : 'No se pudo conectar con Stripe.',
          code: (e as { code?: string }).code || 'respuesta_inesperada',
        }
      }
    }
    if (group === 'ghl') {
      const token = cfg.GHL_API_TOKEN
      const locationId = cfg.GHL_LOCATION_ID
      if (!token || !locationId) return { ok: false, message: 'Faltan el token o el Location ID de GoHighLevel.' }
      const r = await probeFetch(`https://services.leadconnectorhq.com/locations/${encodeURIComponent(locationId)}`, {
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
      // Hotmart EXIGE la cabecera `Authorization: Basic` además de los parámetros: sin ella responde
      // 401 siempre, con las credenciales correctas. Faltaba, así que esta integración no podía
      // conectar nunca. El valor es el "token Basic" que muestra su panel, que es exactamente
      // base64(client_id:client_secret); se acepta pegado a mano por si el suyo difiere.
      const basic =
        cfg.HOTMART_BASIC_TOKEN?.trim() ||
        Buffer.from(`${cfg.HOTMART_CLIENT_ID}:${cfg.HOTMART_CLIENT_SECRET}`).toString('base64')
      const r = await probeFetch(`https://api-sec-vlc.hotmart.com/security/oauth/token?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
      })
      const j = (await r.json().catch(() => ({}))) as { error_description?: string; access_token?: string }
      return r.ok && j.access_token
        ? { ok: true, message: 'Credenciales de Hotmart válidas.' }
        : { ok: false, message: j.error_description || 'Client ID o Secret inválidos.', code: 'token_invalido' }
    }
    if (group === 'whop') {
      if (!cfg.WHOP_API_KEY) return { ok: false, message: 'Falta la API Key de Whop.' }
      const r = await probeFetch('https://api.whop.com/api/v2/me', {
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
        probeFetch('https://api.anthropic.com/v1/models?limit=1', {
          headers: { 'x-api-key': cfg.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        }),
        probeFetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${cfg.GROQ_API_KEY}` },
        }),
      ])
      if (!anthropic.ok || !groq.ok) {
        return {
          ok: false,
          message: `Anthropic: ${anthropic.ok ? 'OK' : anthropic.status}; Groq: ${groq.ok ? 'OK' : groq.status}.`,
        }
      }

      // DeepSeek se comprueba AQUÍ, dentro de la IA, porque es un motor más de los que la plataforma
      // puede usar. Es OPCIONAL: sin clave, la tarjeta no falla — simplemente atiende Anthropic.
      if (!cfg.DEEPSEEK_API_KEY) {
        return { ok: true, message: 'Anthropic y Groq conectados. DeepSeek no está configurado (opcional).' }
      }
      try {
        const modelos = await listarModelos(cfg.DEEPSEEK_API_KEY)
        // El modelo NO se compara contra un nombre escrito en el código: se resuelve contra lo que la
        // cuenta tiene de verdad. Comprobar contra una constante hacía fallar la tarjeta con una
        // clave perfecta solo porque el id por defecto no coincidía con el catálogo del proveedor.
        const { modelo, aviso } = resolverModelo(cfg.DEEPSEEK_MODEL, modelos, DEEPSEEK_MODELOS_PREFERIDOS)
        if (!modelo) {
          return { ok: false, message: aviso ?? 'El modelo guardado no está disponible.', code: 'modelo_no_disponible' }
        }
        return {
          ok: true,
          message: `Anthropic, Groq y DeepSeek conectados. DeepSeek usará ${modelo}${cfg.DEEPSEEK_MODEL ? '' : ' (automático)'}.`,
        }
      } catch (e) {
        const err = e instanceof ModelosError ? e : null
        return {
          ok: false,
          message: `Anthropic y Groq van bien, pero DeepSeek falló: ${err?.message ?? 'no se pudo comprobar'}`,
          code: err?.code === 'token_invalido' ? 'token_invalido' : err?.code === 'red' ? 'red' : undefined,
        }
      }
    }
    if (group === 'youtube') {
      if (!cfg.YOUTUBE_CLIENT_ID || !cfg.YOUTUBE_CLIENT_SECRET || !cfg.YOUTUBE_REFRESH_TOKEN) {
        return { ok: false, message: 'Faltan credenciales OAuth de YouTube.' }
      }
      const r = await probeFetch('https://oauth2.googleapis.com/token', {
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
      const r = await probeFetch('https://simba.sequra.com/mcp', {
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
