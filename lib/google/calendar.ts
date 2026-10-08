// Cliente mínimo de Google Calendar para descubrimiento y, en la siguiente fase, sync incremental.
// REST directo mantiene el bundle serverless pequeño; todas las operaciones tienen timeout.

export type GoogleCalendarListItem = {
  id: string
  name: string
  description: string | null
  timeZone: string | null
  primary: boolean
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner' | string
}

export type GoogleCalendarEvent = {
  providerEventId: string
  iCalUid: string | null
  recurringEventId: string | null
  originalStartAt: string | null
  startAt: string | null
  endAt: string | null
  timeZone: string | null
  status: 'confirmed' | 'tentative' | 'cancelled'
  visibility: string | null
  transparency: string | null
  attendeeEmails: string[]
  isAllDay: boolean
  externalUpdatedAt: string | null
}

type GoogleEventResource = {
  id?: string
  iCalUID?: string
  recurringEventId?: string
  originalStartTime?: { dateTime?: string; date?: string; timeZone?: string }
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  status?: string
  visibility?: string
  transparency?: string
  attendees?: Array<{ email?: string; self?: boolean; resource?: boolean }>
  updated?: string
}

type GoogleEventsResponse = {
  items?: GoogleEventResource[]
  nextPageToken?: string
  nextSyncToken?: string
  error?: { code?: number; message?: string }
}

function eventInstant(value: { dateTime?: string; date?: string } | undefined): string | null {
  if (value?.dateTime) return value.dateTime
  return value?.date ? `${value.date}T00:00:00.000Z` : null
}

export function mapGoogleCalendarEvent(event: GoogleEventResource): GoogleCalendarEvent | null {
  if (!event.id) return null
  const rawStatus = event.status
  const status = rawStatus === 'cancelled' || rawStatus === 'tentative' ? rawStatus : 'confirmed'
  return {
    providerEventId: event.id,
    iCalUid: event.iCalUID || null,
    recurringEventId: event.recurringEventId || null,
    originalStartAt: eventInstant(event.originalStartTime),
    startAt: eventInstant(event.start),
    endAt: eventInstant(event.end),
    timeZone: event.start?.timeZone || event.originalStartTime?.timeZone || null,
    status,
    visibility: event.visibility || null,
    transparency: event.transparency || null,
    attendeeEmails: (event.attendees ?? [])
      .filter((attendee) => !attendee.self && !attendee.resource && attendee.email)
      .map((attendee) => attendee.email!.trim().toLowerCase())
      .filter(Boolean),
    isAllDay: Boolean(event.start?.date && !event.start.dateTime),
    externalUpdatedAt: event.updated || null,
  }
}

export async function listGoogleCalendarEvents(options: {
  accessToken: string
  calendarId: string
  syncToken?: string | null
  timeMin?: string
  timeMax?: string
}): Promise<
  | { items: GoogleCalendarEvent[]; nextSyncToken: string }
  | { error: string; invalidSyncToken: boolean; revoked: boolean }
> {
  const items: GoogleCalendarEvent[] = []
  let pageToken = ''

  for (let page = 0; page < 100; page++) {
    const encodedCalendar = encodeURIComponent(options.calendarId)
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodedCalendar}/events`)
    url.searchParams.set('maxResults', '2500')
    url.searchParams.set('showDeleted', 'true')
    url.searchParams.set('singleEvents', 'true')
    if (options.syncToken) url.searchParams.set('syncToken', options.syncToken)
    else {
      if (options.timeMin) url.searchParams.set('timeMin', options.timeMin)
      if (options.timeMax) url.searchParams.set('timeMax', options.timeMax)
    }
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    let response: Response
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${options.accessToken}` },
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Google Calendar no respondió',
        invalidSyncToken: false,
        revoked: false,
      }
    }
    const payload = (await response.json().catch(() => ({}))) as GoogleEventsResponse
    if (!response.ok) {
      return {
        error: payload.error?.message || `Google Calendar respondió ${response.status}`,
        invalidSyncToken: response.status === 410,
        revoked: response.status === 401 || response.status === 403,
      }
    }
    for (const event of payload.items ?? []) {
      const mapped = mapGoogleCalendarEvent(event)
      if (mapped) items.push(mapped)
    }
    pageToken = payload.nextPageToken || ''
    if (!pageToken) {
      if (!payload.nextSyncToken) {
        return { error: 'Google no devolvió el token incremental final.', invalidSyncToken: false, revoked: false }
      }
      return { items, nextSyncToken: payload.nextSyncToken }
    }
  }

  return { error: 'La sincronización superó el límite seguro de páginas.', invalidSyncToken: false, revoked: false }
}
type CalendarListResponse = {
  items?: Array<{
    id?: string
    summary?: string
    description?: string
    timeZone?: string
    primary?: boolean
    accessRole?: string
    deleted?: boolean
  }>
  nextPageToken?: string
  error?: { message?: string }
}

/** Lista calendarios visibles. Pagina y limita el recorrido para no bloquear una Function. */
export async function listGoogleCalendars(
  accessToken: string
): Promise<{ items: GoogleCalendarListItem[] } | { error: string }> {
  const items: GoogleCalendarListItem[] = []
  let pageToken = ''

  for (let page = 0; page < 10; page++) {
    const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
    url.searchParams.set('maxResults', '250')
    url.searchParams.set('showDeleted', 'false')
    url.searchParams.set('showHidden', 'false')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    let response: Response
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Google Calendar no respondió' }
    }
    const payload = (await response.json().catch(() => ({}))) as CalendarListResponse
    if (!response.ok) return { error: payload.error?.message || `Google Calendar respondió ${response.status}` }

    for (const calendar of payload.items ?? []) {
      if (!calendar.id || calendar.deleted) continue
      items.push({
        id: calendar.id,
        name: calendar.summary?.trim() || calendar.id,
        description: calendar.description?.trim() || null,
        timeZone: calendar.timeZone || null,
        primary: calendar.primary === true,
        accessRole: calendar.accessRole || 'reader',
      })
    }
    pageToken = payload.nextPageToken || ''
    if (!pageToken) return { items }
  }

  return { error: 'La cuenta tiene demasiadas páginas de calendarios; reduce los calendarios visibles y reintenta.' }
}
