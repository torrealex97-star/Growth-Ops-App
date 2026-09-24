import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { countDuplicateKeys, countDuplicateValues, deriveSourceStatus } from '@/lib/data-health'
import { resumenCross, runCrossChecks } from '@/lib/data-health/cross-source'
import { parseAccountIds } from '@/lib/meta/accounts'
import { CONECTORES, pendientesDeMigrar } from '@/lib/conectores/registro'
import { saludDeConector } from '@/lib/data-health/conectores'
import { saludWebhook, type ProveedorWebhook, type SaludWebhook } from '@/lib/data-health/webhooks'
import { eventosStripe, ultimoEventoEnAudit, type ActaAudit, type RawStripe } from '@/lib/webhooks/entrantes'
import { lastRunsByJob } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'

type Contact = {
  id: string
  email: string | null
  phone: string | null
  ghl_contact_id: string | null
  lead_channel: string | null
  merged_into: string | null
  updated_at: string
}
type Appointment = {
  id: string
  contact_id: string | null
  external_source: string | null
  external_id: string | null
  appointment_datetime: string
  recording_url: string | null
  transcript: string | null
  ai_summary: string | null
  updated_at: string
}

/**
 * Última recepción del webhook de Calendly según SU evidencia: las actas que solo ese webhook
 * escribe. Es la misma huella que evalúa `ultimoEventoEnAudit('audit_calendly', …)` en
 * Integraciones — se reutiliza para que Data Health e Integraciones no discrepen sobre qué cuenta
 * como recepción de Calendly (el pull de Calendly no escribe actas, y las actas de los webhooks de
 * GHL comparten entidad y acciones, así que se excluyen por su marcador `via`).
 */
function recepcionCalendly(actas: ActaAudit[]): string | null {
  return ultimoEventoEnAudit('audit_calendly', actas)?.fecha ?? null
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireTenant(tenant)
    if ('error' in auth) return auth.error
    const allowed = ['admin', 'director', 'manager', 'marketing', 'adscripcion']
    if (!auth.isSuperAdmin && !allowed.includes(auth.role ?? ''))
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const cfg = await getTenantConfigWithFallback(auth.tenantId, true)
    const [contactsResult, appointmentsResult, campaignsResult, instagramResult, eventsResult] = await Promise.all([
      sb
        .from('contacts')
        .select('id,email,phone,ghl_contact_id,lead_channel,merged_into,updated_at')
        .eq('tenant_id', auth.tenantId)
        .limit(10000),
      sb
        .from('appointments')
        .select(
          'id,contact_id,external_source,external_id,appointment_datetime,recording_url,transcript,ai_summary,updated_at'
        )
        .eq('tenant_id', auth.tenantId)
        .limit(10000),
      // `name` entra porque el control de atribución compara por NOMBRE contra utm_campaign: sin
      // seleccionarlo, `c.name` era undefined y NINGUNA campaña podía reconocerse como atribuida,
      // así que el control inventaba huecos de atribución que no existían (auditoría F17).
      sb
        .from('campaigns')
        .select('id,name,synced_at')
        .eq('tenant_id', auth.tenantId)
        .eq('provider', 'meta')
        .limit(10000),
      sb.from('ig_media').select('id,synced_at').eq('tenant_id', auth.tenantId).limit(10000),
      sb.from('canonical_events').select('id,received_at').eq('tenant_id', auth.tenantId).limit(10000),
    ])
    const queryError = [contactsResult, appointmentsResult, campaignsResult, instagramResult, eventsResult].find(
      (result) => result.error
    )?.error
    if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 })

    // Conjuntos extra para los controles CRUZADOS. Van aparte y NO abortan la respuesta: si uno falla,
    // su control dice "no se pudo comprobar" y el resto sigue informando. Colapsar todo a un error
    // dejaría la pantalla en blanco por una tabla.
    const [salesResult, stripeResult, attributionsResult, adAccountsResult, pagosResult, cobrosResult] =
      await Promise.all([
        sb.from('sales').select('id,contact_id').eq('tenant_id', auth.tenantId).limit(10000),
        sb.from('stripe_customers').select('id,contact_id').eq('tenant_id', auth.tenantId).limit(10000),
        sb.from('contact_attributions').select('utm_campaign').eq('tenant_id', auth.tenantId).limit(10000),
        sb.from('campaigns').select('account_id').eq('tenant_id', auth.tenantId).eq('provider', 'meta').limit(10000),
        sb.from('stripe_payments').select('payment_id,charge_id,status').eq('tenant_id', auth.tenantId).limit(10000),
        sb
          .from('collections')
          .select('payment_reference')
          .eq('tenant_id', auth.tenantId)
          .not('payment_reference', 'is', null)
          .limit(10000),
      ])

    // EVIDENCIA DE RECEPCIÓN REAL de los webhooks entrantes. A diferencia de la lectura masiva de
    // arriba (limite 10000), son queries acotadas y ordenadas: el dato que hace falta es UNA fecha
    // por webhook, no el histórico. Un fallo NO aborta: sin la fecha, su control dirá "no se pudo
    // comprobar" (desconocido) y el resto de la pantalla sigue informando.
    //  · GHL y Stripe: sobre en `raw_events` (GHL escribe desde F1; Stripe escribe TODO, incluidos
    //    los rechazos de firma — de ahí el filtro de estado).
    //  · Calendly aún no escribe sobre: su huella única vive en `audit_logs` (ver recepcionCalendly).
    const [sobreGhlResult, sobreStripeResult, actasAuditResult] = await Promise.all([
      sb
        .from('raw_events')
        .select('created_at')
        .eq('tenant_id', auth.tenantId)
        .eq('source', 'ghl')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from('raw_events')
        .select('received_at,processing_status')
        .eq('tenant_id', auth.tenantId)
        .eq('source', 'stripe')
        .order('received_at', { ascending: false })
        .limit(50),
      sb
        .from('audit_logs')
        .select('entity_type,action,created_at,new_values')
        .eq('tenant_id', auth.tenantId)
        .order('created_at', { ascending: false })
        .limit(400),
    ])

    // Estado por CONECTOR: sale del historial de ejecuciones y del manifiesto, no de las filas que
    // haya en las tablas. Una integración que lleva días fallando enseña la fecha del último dato
    // bueno y parece sana; esto dice si la tubería sigue abierta. Si el historial falla, la sección
    // se queda vacía y el resto de la pantalla sigue informando.
    const ejecuciones = await lastRunsByJob(sb, auth.tenantId).catch(() => ({}))
    // Solo NOMBRES de claves: de la configuración no sale ni un valor hacia la pantalla.
    const clavesConfiguradas = new Set(
      Object.entries(cfg)
        .filter(([, v]) => !!v?.trim())
        .map(([k]) => k)
    )
    const conectores = CONECTORES.filter((c) => c.manifest.provider !== 'plantilla').map((c) =>
      saludDeConector(c.manifest, { clavesConfiguradas, ejecuciones })
    )

    // SALUD DE LOS WEBHOOKS ENTRANTES (la mitad que ESPERA datos): la evidencia de recepción real de
    // cada uno. Con la integración configurada, 24 h sin recepción = tiempo real roto, aunque el
    // cron siga trayendo datos viejos que disimulen el síntoma. Configurado = credenciales de pull
    // o secret del webhook; una integración que la subcuenta no usa no avisa. GHL y Stripe se leen
    // de `raw_events`; en Stripe, un rechazo de firma es una petición entrante, no una recepción del
    // webhook — lo filtra `eventosStripe`. Calendly aún no escribe sobre: su huella está en
    // `audit_logs` (ver recepcionCalendly).
    const actasAudit: ActaAudit[] = actasAuditResult.error ? [] : ((actasAuditResult.data ?? []) as ActaAudit[])
    const entregasStripe: RawStripe[] | null = sobreStripeResult.error
      ? null
      : ((sobreStripeResult.data ?? []) as RawStripe[])
    const saludes: Record<ProveedorWebhook, SaludWebhook> = {
      ghl: saludWebhook({
        proveedor: 'ghl',
        configurado: Boolean(cfg.GHL_API_TOKEN && cfg.GHL_LOCATION_ID) || clavesConfiguradas.has('GHL_WEBHOOK_SECRET'),
        ultimoSobre: sobreGhlResult.error ? null : (sobreGhlResult.data?.created_at ?? null),
        leido: !sobreGhlResult.error,
      }),
      calendly: saludWebhook({
        proveedor: 'calendly',
        configurado: Boolean(cfg.CALENDLY_API_TOKEN) || clavesConfiguradas.has('CALENDLY_WEBHOOK_SECRET'),
        ultimoSobre: recepcionCalendly(actasAudit),
        leido: !actasAuditResult.error,
      }),
      stripe: saludWebhook({
        proveedor: 'stripe',
        configurado: Boolean(cfg.STRIPE_SECRET_KEY) || clavesConfiguradas.has('STRIPE_WEBHOOK_SECRET'),
        ultimoSobre: entregasStripe ? (eventosStripe(entregasStripe).ultimo_valido?.fecha ?? null) : null,
        leido: entregasStripe !== null,
      }),
    }

    const contacts = (contactsResult.data ?? []) as Contact[]
    const appointments = (appointmentsResult.data ?? []) as Appointment[]
    const campaigns = campaignsResult.data ?? []
    const instagram = instagramResult.data ?? []
    const events = eventsResult.data ?? []
    const bySource = (source: string) => appointments.filter((item) => item.external_source === source)
    const calendly = bySource('calendly')
    const ghlAppointments = bySource('ghl')
    const fathom = appointments.filter((item) => item.recording_url || item.transcript || item.ai_summary)
    const ghlContacts = contacts.filter((item) => item.ghl_contact_id)
    const latest = <T extends Record<string, unknown>>(rows: T[], field: keyof T) =>
      rows
        .map((row) => row[field])
        .filter(Boolean)
        .sort()
        .at(-1) as string | undefined
    const source = (id: string, label: string, configured: boolean, records: number, lastSeen?: string) => ({
      id,
      label,
      configured,
      records,
      lastSeen: lastSeen ?? null,
      status: deriveSourceStatus(configured, records),
    })

    const ventas = salesResult.error
      ? null
      : (salesResult.data ?? []).map((v) => ({ id: v.id, contactId: v.contact_id }))
    const seleccionadas = new Set(parseAccountIds(cfg.META_AD_ACCOUNT_ID))
    const clientesStripe = stripeResult.error
      ? null
      : (stripeResult.data ?? []).map((c) => ({ id: c.id, contactId: c.contact_id }))
    const campanasAtribuidas = attributionsResult.error
      ? null
      : new Set((attributionsResult.data ?? []).map((a) => a.utm_campaign).filter(Boolean))
    const crossChecks = runCrossChecks({
      cuentasSeleccionadas: parseAccountIds(cfg.META_AD_ACCOUNT_ID),
      cuentasConCampanas: adAccountsResult.error
        ? null
        : [...new Set((adAccountsResult.data ?? []).map((c) => c.account_id).filter(Boolean))],
      // Campañas de cuentas FUERA de la selección: la fuga inversa (antes se colaban en dashboards).
      // Con lista vacía en Integraciones ("todas las accesibles") no hay nada fuera de selección.
      campanasFueraDeSeleccion: adAccountsResult.error
        ? null
        : seleccionadas.size > 0
          ? [
              ...new Set(
                (adAccountsResult.data ?? [])
                  .map((c) => c.account_id)
                  .filter((a): a is string => !!a && !seleccionadas.has(a))
              ),
            ]
          : [],
      clientesStripe,
      pagosStripe: pagosResult.error
        ? null
        : (pagosResult.data ?? []).map((p) => ({
            id: p.payment_id,
            refs: [p.payment_id, p.charge_id].filter(Boolean),
            status: p.status,
          })),
      referenciasCobro: cobrosResult.error
        ? null
        : (cobrosResult.data ?? []).map((c) => c.payment_reference).filter(Boolean),
      contactosConVenta: ventas === null ? null : [...new Set(ventas.map((v) => v.contactId).filter(Boolean))],
      ventas,
      contactos: contacts.map((c) => c.id),
      // Una campaña cuenta como atribuida si algún contacto la trae en su utm_campaign. Se compara por
      // nombre porque es lo que guarda la atribución; el id interno no viaja en la URL del anuncio.
      campanas:
        campanasAtribuidas === null
          ? null
          : campaigns.map((c) => ({
              id: c.id,
              conAtribucion: campanasAtribuidas.has((c as { name?: string | null }).name ?? ''),
            })),
      agendas: appointments.map((a) => ({ id: a.id, contactId: a.contact_id })),
      // Una llamada es una cita con grabación: si no hay cita, no hay grabación que colgar de nada.
      llamadas: appointments
        .filter((a) => a.recording_url)
        .map((a) => ({ id: a.id, appointmentId: a.contact_id ? a.id : null })),
      ultimaSyncPorFuente: {
        // `latest` da undefined si no hay filas; para el control eso es "nunca sincronizada", que es
        // null, no un hueco sin significado.
        meta: latest(campaigns, 'synced_at') ?? null,
        instagram: latest(instagram, 'synced_at') ?? null,
        tracking: latest(events, 'received_at') ?? null,
      },
    })

    return NextResponse.json({
      conectores,
      // Cuántas integraciones siguen sin contrato: la sección dice de qué está hablando y de qué no.
      conectoresPendientes: pendientesDeMigrar(),
      // Forma plana por compatibilidad con el panel (sección "Webhooks entrantes").
      saludWebhookGhl: saludes.ghl,
      // El mismo control para el resto de webhooks entrantes: misma regla, otra evidencia.
      saludWebhooksEntrantes: [
        { proveedor: 'calendly', ...saludes.calendly },
        { proveedor: 'stripe', ...saludes.stripe },
      ],
      totals: { contacts: contacts.length, appointments: appointments.length },
      sources: [
        source('meta', 'Meta Ads', Boolean(cfg.META_ACCESS_TOKEN), campaigns.length, latest(campaigns, 'synced_at')),
        source('instagram', 'Instagram', Boolean(cfg.IG_USER_ID), instagram.length, latest(instagram, 'synced_at')),
        source(
          'calendly',
          'Calendly',
          Boolean(cfg.CALENDLY_API_TOKEN),
          calendly.length,
          latest(calendly, 'updated_at')
        ),
        source(
          'ghl',
          'HighLevel',
          Boolean(cfg.GHL_API_TOKEN && cfg.GHL_LOCATION_ID),
          ghlContacts.length + ghlAppointments.length,
          latest([...ghlContacts, ...ghlAppointments], 'updated_at')
        ),
        source('fathom', 'Fathom', Boolean(cfg.FATHOM_API_KEY), fathom.length, latest(fathom, 'updated_at')),
        source(
          'tracking',
          'Tracking canónico',
          Boolean(cfg.TRACKING_INGEST_KEY),
          events.length,
          latest(events, 'received_at')
        ),
      ],
      integrity: {
        duplicateEmails: countDuplicateValues(contacts.map((item) => item.email)),
        duplicatePhones: countDuplicateValues(contacts.map((item) => item.phone)),
        duplicateExternalAppointments: countDuplicateKeys(
          appointments.map((item) =>
            item.external_source && item.external_id ? `${item.external_source}:${item.external_id}` : null
          )
        ),
        duplicateContactTimes: countDuplicateKeys(
          appointments.map((item) => (item.contact_id ? `${item.contact_id}:${item.appointment_datetime}` : null))
        ),
        appointmentsWithoutContact: appointments.filter((item) => !item.contact_id).length,
        // Hueco de CAPTURA (no de limpieza): contactos vivos sin canal de origen declarado. Los
        // fusionados (merged_into) no son personas reales y no cuentan. Un hueco no se rellena con
        // un valor inventado: se cuenta y se corrige en los puntos de captura.
        leadChannelGaps: contacts.filter((item) => !item.lead_channel && !item.merged_into).length,
      },
      // Controles CRUZADOS: no "¿la fuente responde?" sino "¿lo que trajo encaja con el resto?". Cada
      // fuente puede estar verde y el recorrido completo estar roto por la mitad.
      crossSource: crossChecks,
      crossSummary: resumenCross(crossChecks),
    })
  } catch (err) {
    console.error('[api/settings/data-health GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
