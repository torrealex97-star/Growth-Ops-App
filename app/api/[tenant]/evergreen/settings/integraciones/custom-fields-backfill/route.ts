import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'
import { serviceClient, text } from '@/lib/integrations/citas-sync'
import {
  aplicarCustomFieldsGhl,
  slugGhlField,
  tipoDesdeGhl,
  type CustomFieldValue,
} from '@/lib/contacts/custom-fields-ghl'

export const runtime = 'nodejs'
export const maxDuration = 60

// BACKFILL de custom fields de GHL (§ campos personalizados).
//
// 1. Sincroniza el CATÁLOGO de la ubicación (GET /locations/{id}/customFields): es la única
//    fuente con el nombre legible y el tipo declarado de cada campo. Re-etiqueta definiciones
//    que se crearon con el ID crudo de GHL como label.
// 2. Relee los contactos DESDE LA API de GHL y hace merge idempotente en contacts.custom_fields,
//    traduciendo los IDs de campo de GHL a nombres legibles antes de mapear.
//
// Presupuesto: 25 s propios — lo que no entre lo trae la siguiente pasada (merge idempotente).
// Estado precargado en memoria (defs + contactos locales): cero queries de resolución por contacto.

type Json = Record<string, unknown>

/** ¿Pinta de ID crudo de GHL? (20 chars alfanuméricos, no un nombre humano) */
function pareceIdGhl(label: string): boolean {
  return /^[A-Za-z0-9_-]{18,24}$/.test(label)
}

export async function POST(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!['admin', 'director'].includes(t.role || '')) {
    return NextResponse.json({ error: 'Solo admin/director pueden lanzar el backfill' }, { status: 403 })
  }

  const cfg = await getTenantConfigWithFallback(t.tenantId, true)
  const token = cfg.GHL_API_TOKEN
  const locationId = cfg.GHL_LOCATION_ID
  if (!token || !locationId) {
    return NextResponse.json({ error: 'GHL no está configurado en Integraciones (token o location)' }, { status: 400 })
  }

  const sb = serviceClient()
  try {
    const result = await recordSyncRun(
      sb,
      { tenantId: t.tenantId, provider: 'ghl', job: 'ghl-custom-fields', trigger: 'manual', secrets: [token] },
      async () => {
        const headers = { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' }
        const deadline = Date.now() + 45_000

        // ── 1. CATÁLOGO de la ubicación: id → { nombre, tipo } ────────────────────────
        const idToNombre = new Map<string, string>()
        const idToTipo = new Map<string, 'text' | 'number' | 'boolean' | 'date'>()
        let definicionesReetiquetadas = 0
        try {
          const urlCat = new URL(`https://services.leadconnectorhq.com/locations/${locationId}/customFields`)
          const resCat = await fetch(urlCat, { headers, signal: AbortSignal.timeout(15_000) })
          const bodyCat = (await resCat.json().catch(() => ({}))) as { customFields?: Json[] }
          for (const f of bodyCat.customFields ?? []) {
            const id = text(f.id)
            const nombre = text(f.name) ?? text(f.fieldKey)
            if (!id || !nombre) continue
            idToNombre.set(id, nombre)
            idToTipo.set(id, tipoDesdeGhl(text(f.type) ?? text(f.dataType)))
          }
        } catch {
          // Sin catálogo seguimos: los nombres quedarán como el label que traiga el contacto.
        }

        // Re-etiquetar definiciones que se crearon con el ID crudo de GHL.
        if (idToNombre.size > 0) {
          const { data: defsLocales } = await sb
            .from('custom_field_defs')
            .select('id, label, field_type')
            .eq('tenant_id', t.tenantId)
          for (const def of defsLocales ?? []) {
            const nombre = idToNombre.get(def.label)
            if (!nombre || !pareceIdGhl(def.label)) continue
            const { error } = await sb
              .from('custom_field_defs')
              .update({
                label: nombre,
                field_key: slugGhlField(nombre),
                ...(def.field_type === 'text' && idToTipo.get(def.label) !== 'text'
                  ? { field_type: idToTipo.get(def.label) }
                  : {}),
              })
              .eq('id', def.id)
            if (!error) definicionesReetiquetadas++
          }
        }

        // ── 2. ESTADO LOCAL precargado: defs (field_key → id) y contactos ─────────────
        const defsCache = new Map<string, Map<string, string>>()
        const keyToId = new Map<string, string>()
        defsCache.set('map', keyToId)
        {
          const { data: defs } = await sb.from('custom_field_defs').select('id, field_key').eq('tenant_id', t.tenantId)
          for (const d of defs ?? []) keyToId.set(d.field_key, d.id)
        }

        const porGhlId = new Map<string, { id: string; cf: Record<string, CustomFieldValue> | null }>()
        const porEmail = new Map<string, { id: string; cf: Record<string, CustomFieldValue> | null }>()
        {
          let desde = 0
          for (;;) {
            const { data: filas, error } = await sb
              .from('contacts')
              .select('id, email, ghl_contact_id, custom_fields')
              .eq('tenant_id', t.tenantId)
              .range(desde, desde + 999)
            if (error) throw error
            for (const c of filas ?? []) {
              const cf = (c.custom_fields as Record<string, CustomFieldValue> | null) ?? null
              if (c.ghl_contact_id) porGhlId.set(c.ghl_contact_id, { id: c.id, cf })
              if (c.email) porEmail.set(c.email.toLowerCase(), { id: c.id, cf })
            }
            if ((filas ?? []).length < 1000) break
            desde += 1000
          }
        }

        // ── 3. CONTACTOS desde la API de GHL, en páginas de 100 ───────────────────────
        // GHL pagina con el cursor que devuelve en meta (nextStartAfterId / startAfter);
        // enviar startAfterId propio resulta IGNORADO y la página 2 repite la 1.
        let cursor = ''
        let nextUrl: string | null = null // GHL entrega literal la URL de la siguiente página
        let pages = 0
        let contactos = 0
        let conCampos = 0
        let definicionesCreadas = 0
        let cortado = false
        const vistos = new Set<string>()
        const pendientes: Array<{ id: string; custom_fields: Record<string, CustomFieldValue> }> = [] // escritura por lotes al final de cada página
        let metaDiagnostico: Json | null = null // cursor real de GHL: solo IDs, nada sensible

        while (pages < 100) {
          if (Date.now() > deadline) {
            cortado = true
            break
          }
          const url = nextUrl
            ? new URL(nextUrl)
            : (() => {
                const u = new URL('https://services.leadconnectorhq.com/contacts/')
                u.searchParams.set('locationId', locationId)
                u.searchParams.set('limit', '100')
                return u
              })()
          const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) })
          const body = (await response.json().catch(() => ({}))) as {
            contacts?: Json[]
            meta?: Json
            message?: string
          }
          if (!response.ok) throw new Error(body.message || `GHL respondió ${response.status}`)
          const contacts = body.contacts ?? []
          if (contacts.length === 0) break

          for (const contact of contacts) {
            if (Date.now() > deadline) {
              cortado = true
              break
            }
            const contactId = text(contact.id)
            if (!contactId) continue
            if (vistos.has(contactId)) continue // cursor ignorado → no re-procesar
            vistos.add(contactId)
            const email = text(contact.email)?.toLowerCase() || null
            const local = porGhlId.get(contactId) ?? (email ? porEmail.get(email) : undefined)
            if (!local) continue
            contactos++

            // Traducir IDs de campo GHL → nombres legibles del catálogo antes de mapear.
            const fuente: Json = { ...contact }
            const cf = contact.customFields ?? contact.customData ?? contact.custom_data
            if (Array.isArray(cf)) {
              fuente.customFields = cf.map((it) => {
                const obj = it as Json
                const nombre = idToNombre.get(String(obj?.id ?? obj?.key ?? ''))
                return nombre ? { ...obj, name: nombre } : obj
              })
            } else if (cf && typeof cf === 'object') {
              const traducido: Json = {}
              for (const [k, v] of Object.entries(cf as Json)) {
                traducido[idToNombre.get(k) ?? k] = v
              }
              fuente.customFields = traducido
            }

            const antes = JSON.stringify(local.cf ?? {})
            const { customFields } = await aplicarCustomFieldsGhl(sb, t.tenantId, local.id, fuente, defsCache, {
              customFieldsActuales: local.cf,
            })
            // Solo en cola si el merge CAMBIÓ (re-runs baratos; upsert parcial rompe NOT NULLs).
            if (customFields && Object.keys(customFields).length > 0 && JSON.stringify(customFields) !== antes) {
              pendientes.push({ id: local.id, custom_fields: customFields })
              local.cf = customFields
            }
          }

          pages++
          // Escritura: UPDATE por contacto, solo los cambiados en esta página.
          const lote = pendientes.splice(0)
          for (const p of lote) {
            const { error } = await sb
              .from('contacts')
              .update({ custom_fields: p.custom_fields })
              .eq('tenant_id', t.tenantId)
              .eq('id', p.id)
            if (error) throw new Error(`update contacto: ${JSON.stringify(error)}`)
            conCampos++
          }
          const meta = (body.meta ?? {}) as Json
          metaDiagnostico = {
            currentPage: meta.currentPage ?? null,
            nextPage: meta.nextPage ?? null,
            recibidos: contacts.length,
          }
          // La paginación real de GHL es por página: seguimos la nextPageUrl que entrega.
          const proxima = typeof meta.nextPageUrl === 'string' ? meta.nextPageUrl : null
          if (!proxima || contacts.length === 0) break
          nextUrl = proxima
        }

        return {
          contactos,
          conCampos,
          definicionesCreadas,
          definicionesReetiquetadas,
          pages,
          cortado,
          metaUltimaPagina: metaDiagnostico,
        }
      },
      (r) => ({
        rowsWritten: r.conCampos,
        detail: {
          contactos_revisados: r.contactos,
          con_custom_fields: r.conCampos,
          definiciones_creadas: r.definicionesCreadas,
          definiciones_reetiquetadas: r.definicionesReetiquetadas,
          paginas: r.pages,
          cortado_por_presupuesto: r.cortado,
          diagnostico_cursor: r.metaUltimaPagina,
        },
      })
    )
    return NextResponse.json({ provider: 'ghl', ...result })
  } catch (error) {
    if (error instanceof SyncBusyError) return NextResponse.json({ error: error.message }, { status: 409 })
    const msg = error instanceof Error ? error.message : JSON.stringify(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
