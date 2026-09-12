import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { countDuplicateKeys, countDuplicateValues, deriveSourceStatus } from '@/lib/data-health'

export const runtime = 'nodejs'

type Contact = {
  id: string
  email: string | null
  phone: string | null
  ghl_contact_id: string | null
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

export async function GET(_request: Request, { params }: { params: Promise<{ tenant: string }> }) {
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
    sb.from('contacts').select('id,email,phone,ghl_contact_id,updated_at').eq('tenant_id', auth.tenantId).limit(10000),
    sb
      .from('appointments')
      .select(
        'id,contact_id,external_source,external_id,appointment_datetime,recording_url,transcript,ai_summary,updated_at'
      )
      .eq('tenant_id', auth.tenantId)
      .limit(10000),
    sb.from('campaigns').select('id,synced_at').eq('tenant_id', auth.tenantId).eq('provider', 'meta').limit(10000),
    sb.from('ig_media').select('id,synced_at').eq('tenant_id', auth.tenantId).limit(10000),
    sb.from('canonical_events').select('id,received_at').eq('tenant_id', auth.tenantId).limit(10000),
  ])
  const queryError = [contactsResult, appointmentsResult, campaignsResult, instagramResult, eventsResult].find(
    (result) => result.error
  )?.error
  if (queryError) return NextResponse.json({ error: queryError.message }, { status: 500 })

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

  return NextResponse.json({
    totals: { contacts: contacts.length, appointments: appointments.length },
    sources: [
      source('meta', 'Meta Ads', Boolean(cfg.META_ACCESS_TOKEN), campaigns.length, latest(campaigns, 'synced_at')),
      source('instagram', 'Instagram', Boolean(cfg.IG_USER_ID), instagram.length, latest(instagram, 'synced_at')),
      source('calendly', 'Calendly', Boolean(cfg.CALENDLY_API_TOKEN), calendly.length, latest(calendly, 'updated_at')),
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
    },
  })
}
