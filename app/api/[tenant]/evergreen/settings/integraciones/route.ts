import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { encryptSecret, invalidateConfigCache, ensureConfig } from '@/lib/config'
import { ALL_FIELDS, SECRET_KEYS, isKnownKey, INTEGRATION_GROUPS } from '@/lib/integrations-catalog'
import { parseAccountIds, fetchAdAccounts } from '@/lib/meta/client'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

async function requireAdmin(tenantSlug: string): Promise<
  | { ok: true; callerId: string; tenantId: string }
  | { ok: false; res: NextResponse }
> {
  const t = await requireTenant(tenantSlug)
  if ('error' in t) return { ok: false, res: t.error }
  const sb = svc()
  const { data: row } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
  const role = (row?.roles as { key?: string } | null)?.key
  if (role !== 'admin' && role !== 'director') {
    return { ok: false, res: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return { ok: true, callerId: t.userId, tenantId: t.tenantId }
}

function svc(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } })
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
    const { data } = await svc().from('integration_settings').select('key,value,is_secret').eq('tenant_id', auth.tenantId)
    for (const r of data ?? []) dbRows[(r as { key: string }).key] = r as { value: string | null; is_secret: boolean }
  } catch { /* tabla sin migrar */ }

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
  return NextResponse.json({ encReady, groups: INTEGRATION_GROUPS, state })
}

// POST — guardar cambios. body: { updates: { KEY: value } }.
// Secreto con valor vacío => NO se toca (para no borrar al no reescribir el campo enmascarado).
// Para BORRAR una clave: enviar { clear: ["KEY", …] }.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireAdmin(tenant)
  if (!auth.ok) return auth.res

  const body = await req.json().catch(() => ({})) as { action?: string; group?: string; updates?: Record<string, string>; clear?: string[] }

  if (body.action === 'test') return runTest(body.group || '', auth.tenantId)

  const updates = body.updates || {}
  const clear = body.clear || []
  const client = svc()
  const rows: { key: string; tenant_id: string; value: string; is_secret: boolean; updated_by: string }[] = []
  const needsEnc = ALL_FIELDS.some((f) => f.secret && updates[f.key])

  if (needsEnc && !process.env.CONFIG_ENC_KEY) {
    return NextResponse.json({ error: 'Falta CONFIG_ENC_KEY en el entorno; no se pueden guardar secretos cifrados.' }, { status: 400 })
  }

  for (const [key, raw] of Object.entries(updates)) {
    if (!isKnownKey(key)) continue
    const val = (raw ?? '').trim()
    const secret = SECRET_KEYS.has(key)
    if (secret && val === '') continue // no reescribir secreto en blanco
    rows.push({ key, tenant_id: auth.tenantId, value: secret ? encryptSecret(val) : val, is_secret: secret, updated_by: auth.callerId })
  }

  if (rows.length) {
    // NOTA: el índice único original era (key) global; ver la migración
    // supabase/migrations/20260911160000_fix_cron_unique_constraints.sql (pendiente
    // de aplicar) que lo sustituye por (tenant_id, key) — sin eso, dos subcuentas
    // guardando la misma clave (p.ej. META_ACCESS_TOKEN) se pisarían entre sí.
    const { error } = await client.from('integration_settings').upsert(rows, { onConflict: 'tenant_id,key' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (clear.length) {
    await client.from('integration_settings').delete().eq('tenant_id', auth.tenantId).in('key', clear.filter(isKnownKey))
  }

  invalidateConfigCache(auth.tenantId)
  await ensureConfig(auth.tenantId, true).catch(() => {})
  return NextResponse.json({ ok: true, saved: rows.length, cleared: clear.length })
}

// ── Probar conexión por integración ─────────────────────────────────────────
function metaProof(token: string, appSecret?: string): string {
  if (!appSecret) return ''
  return crypto.createHmac('sha256', appSecret).update(token).digest('hex')
}

async function runTest(group: string, tenantId: string): Promise<NextResponse> {
  await ensureConfig(tenantId, true).catch(() => {})
  try {
    if (group === 'meta') {
      const token = process.env.META_ACCESS_TOKEN
      if (!token) return NextResponse.json({ ok: false, message: 'Falta el token de Meta.' })
      const ver = process.env.META_API_VERSION || 'v21.0'
      const proof = metaProof(token, process.env.META_APP_SECRET)
      const proofQs = proof ? `&appsecret_proof=${proof}` : ''
      const accounts = parseAccountIds(process.env.META_AD_ACCOUNT_ID)
      // Sin cuentas explícitas → modo "todas": descubrir las accesibles por el token.
      if (accounts.length === 0) {
        try {
          const all = await fetchAdAccounts(token, ver, process.env.META_APP_SECRET)
          if (all.length === 0) {
            return NextResponse.json({ ok: false, message: 'Token válido pero sin acceso a ninguna cuenta publicitaria (revisa permisos ads_read).' })
          }
          return NextResponse.json({ ok: true, message: `${all.length} cuenta(s) detectada(s): ${all.map((a) => a.name).join(', ')}` })
        } catch (e) {
          return NextResponse.json({ ok: false, message: `No se pudieron listar las cuentas: ${(e as Error).message}` })
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
        return NextResponse.json({ ok: false, message: `Fallo en ${failed.map((f) => f.acc).join(', ')}: ${failed[0].err || 'Error de Meta'}` })
      }
      const names = results.map((r) => r.name || r.acc)
      return NextResponse.json({ ok: true, message: results.length === 1 ? `Cuenta: ${names[0]}` : `${results.length} cuentas OK: ${names.join(', ')}` })
    }
    if (group === 'instagram') {
      const token = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN
      if (!token) return NextResponse.json({ ok: false, message: 'Falta el token de Instagram/Meta.' })
      const ver = process.env.META_API_VERSION || 'v21.0'
      const proof = metaProof(token, process.env.META_APP_SECRET)
      const url = `https://graph.facebook.com/${ver}/me/accounts?fields=name&access_token=${encodeURIComponent(token)}${proof ? `&appsecret_proof=${proof}` : ''}`
      const r = await fetch(url)
      const j = await r.json()
      return r.ok
        ? NextResponse.json({ ok: true, message: 'Token válido.' })
        : NextResponse.json({ ok: false, message: j.error?.message || 'Error de Instagram' })
    }
    if (group === 'calendly') {
      const token = process.env.CALENDLY_API_TOKEN
      if (!token) return NextResponse.json({ ok: false, message: 'Falta el PAT de Calendly.' })
      const r = await fetch('https://api.calendly.com/users/me', { headers: { Authorization: `Bearer ${token}` } })
      const j = await r.json()
      return r.ok
        ? NextResponse.json({ ok: true, message: `Usuario: ${j.resource?.name || 'OK'}` })
        : NextResponse.json({ ok: false, message: j.message || 'Token inválido' })
    }
    if (group === 'email') {
      const key = process.env.RESEND_API_KEY
      if (!key) return NextResponse.json({ ok: false, message: 'Falta la API key de Resend.' })
      const from = process.env.RESEND_FROM || ''
      const fromDomain = from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() || null
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } })
      if (r.ok) {
        const j = await r.json().catch(() => ({})) as { data?: { name: string; status: string }[] }
        const domains = j.data ?? []
        const verified = domains.filter((d) => d.status === 'verified').map((d) => d.name.toLowerCase())
        if (!fromDomain) {
          return NextResponse.json({ ok: false, message: `Falta configurar el remitente (RESEND_FROM). Dominios verificados: ${verified.join(', ') || 'ninguno'}.` })
        }
        if (!verified.includes(fromDomain)) {
          return NextResponse.json({ ok: false, message: `API key válida, pero el dominio "${fromDomain}" del remitente NO está verificado en Resend. Añádelo y verifícalo en resend.com/domains (o usa un remitente de un dominio verificado: ${verified.join(', ') || 'ninguno'}).` })
        }
        return NextResponse.json({ ok: true, message: `Conexión correcta. Dominio "${fromDomain}" verificado.` })
      }
      // Key de tipo "solo envío": no tiene permiso para listar dominios (401 restricted_api_key).
      // Sigue siendo válida para enviar, así que hacemos una comprobación real intentando un envío
      // de prueba sin destinatario válido para que Resend nos diga si el dominio está verificado.
      const j = await r.json().catch(() => ({})) as { name?: string }
      if (r.status === 401 && j?.name === 'restricted_api_key') {
        const probe = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: from || 'onboarding@resend.dev', to: ['verificacion@resend.dev'], subject: 'ping', html: '<p>ping</p>' }),
        })
        const pj = await probe.json().catch(() => ({})) as { message?: string; name?: string }
        if (probe.ok) return NextResponse.json({ ok: true, message: `Conexión correcta (key de solo envío). Remitente "${fromDomain || from}".` })
        if (/not verified/i.test(pj.message || '')) {
          return NextResponse.json({ ok: false, message: `El dominio "${fromDomain}" del remitente NO está verificado en Resend. Añádelo y verifícalo en resend.com/domains.` })
        }
        return NextResponse.json({ ok: false, message: pj.message || 'No se pudo enviar el correo de prueba.' })
      }
      return NextResponse.json({ ok: false, message: 'API key inválida.' })
    }
    return NextResponse.json({ ok: false, message: 'Esta integración no tiene prueba automática.' })
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message })
  }
}
