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
