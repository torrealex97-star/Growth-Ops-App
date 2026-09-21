import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'
import { serviceClient, text } from '@/lib/integrations/citas-sync'
import { aplicarCustomFieldsGhl } from '@/lib/contacts/custom-fields-ghl'

export const runtime = 'nodejs'
export const maxDuration = 60

// BACKFILL de custom fields de GHL (§ campos personalizados).
//
// Relee los contactos de la subcuenta DESDE LA API de GHL (la fuente de verdad de sus campos
// personalizados — nunca de payloads locales, que no se persisten) y hace merge idempotente
// en contacts.custom_fields, creando en la subcuenta las definiciones que falten.
//
// Presupuesto: 25 s propios (los mismos cortes que el cron de citas) — lo que no entre lo trae
// la siguiente pasada (el merge es idempotente; re-ejecutar nunca duplica ni pisa).

type Json = Record<string, unknown>

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
        const deadline = Date.now() + 25_000
        const customDefsCache = new Map<string, Map<string, string>>()
        let startAfterId = ''
        let pages = 0
        let contactos = 0
        let conCampos = 0
        let definicionesCreadas = 0
        let cortado = false

        while (pages < 100) {
          if (Date.now() > deadline) {
            cortado = true
            break
          }
          const url = new URL('https://services.leadconnectorhq.com/contacts/')
          url.searchParams.set('locationId', locationId)
          url.searchParams.set('limit', '100')
          if (startAfterId) url.searchParams.set('startAfterId', startAfterId)
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
            // Resolver el contacto LOCAL por ghl_contact_id (o email como respaldo) — nunca crear.
            let localId: string | null = null
            const porGhl = await sb
              .from('contacts')
              .select('id')
              .eq('tenant_id', t.tenantId)
              .eq('ghl_contact_id', contactId)
              .maybeSingle()
            localId = porGhl.data?.id ?? null
            if (!localId) {
              const email = text(contact.email)?.toLowerCase() || null
              if (email) {
                const porEmail = await sb
                  .from('contacts')
                  .select('id')
                  .eq('tenant_id', t.tenantId)
                  .eq('email', email)
                  .maybeSingle()
                localId = porEmail.data?.id ?? null
              }
            }
            if (!localId) continue
            contactos++
            const { customFields, creadas } = await aplicarCustomFieldsGhl(
              sb,
              t.tenantId,
              localId,
              contact,
              customDefsCache
            )
            definicionesCreadas += creadas
            if (customFields && Object.keys(customFields).length > 0) {
              const { error } = await sb
                .from('contacts')
                .update({ custom_fields: customFields })
                .eq('tenant_id', t.tenantId)
                .eq('id', localId)
              if (error) throw error
              conCampos++
            }
          }

          pages++
          const last = contacts.at(-1)
          if (!last || contacts.length < 100) break
          const nextId = text(last.id)
          if (!nextId || nextId === startAfterId) break
          startAfterId = nextId
        }

        return { contactos, conCampos, definicionesCreadas, pages, cortado }
      },
      (r) => ({
        rowsWritten: r.conCampos,
        detail: {
          contactos_revisados: r.contactos,
          con_custom_fields: r.conCampos,
          definiciones_creadas: r.definicionesCreadas,
          paginas: r.pages,
          cortado_por_presupuesto: r.cortado,
        },
      })
    )
    return NextResponse.json({ provider: 'ghl', ...result })
  } catch (error) {
    if (error instanceof SyncBusyError) return NextResponse.json({ error: error.message }, { status: 409 })
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
