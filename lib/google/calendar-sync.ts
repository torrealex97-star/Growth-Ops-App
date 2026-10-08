import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { accessTokenFromRefresh } from '@/lib/google/ga4'
import { listGoogleCalendarEvents } from '@/lib/google/calendar'
import { googleCredentials } from '@/lib/google/oauth'

type CalendarRow = {
  id: string
  external_calendar_id: string
  sync_token: string | null
}

export type GoogleCalendarSyncResult = {
  calendars: number
  eventsWritten: number
  fullSyncs: number
  incrementalSyncs: number
  reconnectRequired: boolean
  failures: string[]
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString()
}

export function attendeeFingerprint(email: string, secret: string): string {
  return createHmac('sha256', secret).update(`google-calendar-attendee:${email.trim().toLowerCase()}`).digest('hex')
}

export async function syncGoogleCalendars(options: {
  sb: SupabaseClient
  tenantId: string
  userId: string
  ownerEmail: string | null
  encryptedRefreshToken: string
  calendars: CalendarRow[]
  now?: Date
}): Promise<GoogleCalendarSyncResult> {
  const result: GoogleCalendarSyncResult = {
    calendars: options.calendars.length,
    eventsWritten: 0,
    fullSyncs: 0,
    incrementalSyncs: 0,
    reconnectRequired: false,
    failures: [],
  }
  const creds = await googleCredentials(options.tenantId)
  if (!creds) throw new Error('Faltan las credenciales OAuth de Google del tenant.')
  const access = await accessTokenFromRefresh(options.encryptedRefreshToken, creds)
  if ('error' in access) {
    const error = new Error(access.error) as Error & { code?: string }
    error.code = access.revoked ? 'oauth_revocado' : 'oauth_token'
    throw error
  }

  const fingerprintSecret = process.env.CONFIG_ENC_KEY
  if (!fingerprintSecret) throw new Error('Falta CONFIG_ENC_KEY para proteger las identidades de asistentes.')
  const ownerEmail = options.ownerEmail?.trim().toLowerCase() || null
  const now = options.now ?? new Date()

  for (const calendar of options.calendars) {
    let incremental = Boolean(calendar.sync_token)
    let page = await listGoogleCalendarEvents({
      accessToken: access.token,
      calendarId: calendar.external_calendar_id,
      syncToken: calendar.sync_token,
      timeMin: addDays(now, -90),
      timeMax: addDays(now, 180),
    })

    if ('error' in page && page.invalidSyncToken) {
      incremental = false
      page = await listGoogleCalendarEvents({
        accessToken: access.token,
        calendarId: calendar.external_calendar_id,
        timeMin: addDays(now, -90),
        timeMax: addDays(now, 180),
      })
    }
    if ('error' in page) {
      if (page.revoked) result.reconnectRequired = true
      result.failures.push(`${calendar.id}: ${page.error}`)
      const failed = await options.sb
        .from('google_connected_calendars')
        .update({ last_error_code: page.revoked ? 'oauth_revocado' : 'sync_error' })
        .eq('tenant_id', options.tenantId)
        .eq('owner_user_id', options.userId)
        .eq('id', calendar.id)
      if (failed.error) result.failures.push(`${calendar.id}: no se pudo guardar el estado de error`)
      continue
    }

    const seenAt = new Date().toISOString()
    const rows = page.items.map((event) => {
      const externalAttendees = event.attendeeEmails.filter((email) => email !== ownerEmail)
      return {
        tenant_id: options.tenantId,
        connected_calendar_id: calendar.id,
        owner_user_id: options.userId,
        provider_event_id: event.providerEventId,
        ical_uid: event.iCalUid,
        recurring_event_id: event.recurringEventId,
        original_start_at: event.originalStartAt,
        event_start_at: event.startAt,
        event_end_at: event.endAt,
        time_zone: event.timeZone,
        status: event.status,
        visibility: event.visibility,
        transparency: event.transparency,
        attendee_fingerprints: [
          ...new Set(externalAttendees.map((email) => attendeeFingerprint(email, fingerprintSecret))),
        ],
        has_external_attendee: externalAttendees.length > 0,
        is_all_day: event.isAllDay,
        external_updated_at: event.externalUpdatedAt,
        last_seen_at: seenAt,
      }
    })

    let calendarFailed = false
    for (let index = 0; index < rows.length; index += 500) {
      const batch = rows.slice(index, index + 500)
      if (batch.length === 0) continue
      const written = await options.sb
        .from('google_calendar_events')
        .upsert(batch, { onConflict: 'tenant_id,connected_calendar_id,provider_event_id' })
      if (written.error) {
        calendarFailed = true
        result.failures.push(`${calendar.id}: ${written.error.message}`)
        break
      }
      result.eventsWritten += batch.length
    }
    if (calendarFailed) continue

    const synced = await options.sb
      .from('google_connected_calendars')
      .update({
        sync_token: page.nextSyncToken,
        last_sync_at: seenAt,
        last_full_sync_at: incremental ? undefined : seenAt,
        last_incremental_sync_at: incremental ? seenAt : undefined,
        last_error_code: null,
      })
      .eq('tenant_id', options.tenantId)
      .eq('owner_user_id', options.userId)
      .eq('id', calendar.id)
      .select('id')
    if (synced.error || synced.data?.length !== 1) {
      result.failures.push(`${calendar.id}: no se pudo confirmar el cursor de sincronización`)
      continue
    }
    if (incremental) result.incrementalSyncs += 1
    else result.fullSyncs += 1
  }
  return result
}
