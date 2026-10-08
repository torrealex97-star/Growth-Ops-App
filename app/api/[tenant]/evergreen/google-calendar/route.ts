import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { googleCredentials } from '@/lib/google/oauth'
import { accessTokenFromRefresh } from '@/lib/google/ga4'
import { listGoogleCalendars, type GoogleCalendarListItem } from '@/lib/google/calendar'
import { syncGoogleCalendars } from '@/lib/google/calendar-sync'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'

type CalendarRole = 'primary' | 'conflict' | 'read_only'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
async function ownConnection(tenantId: string, userId: string) {
  const sb = serviceClient()
  const result = await sb
    .from('google_oauth_connections')
    .select('id, google_email, refresh_token, scopes, status, last_sync_at, last_error, updated_at')
    .eq('tenant_id', tenantId)
    .eq('provider', 'calendar')
    .eq('owner_user_id', userId)
    .maybeSingle()
  if (result.error) throw result.error
  return { sb, connection: result.data }
}

async function usableGoogleCalendars(tenantId: string, encryptedRefreshToken: string) {
  const creds = await googleCredentials(tenantId)
  if (!creds) return { error: 'Faltan las credenciales OAuth de Google del tenant.', revoked: false } as const
  const access = await accessTokenFromRefresh(encryptedRefreshToken, creds)
  if ('error' in access) return access
  const calendars = await listGoogleCalendars(access.token)
  if ('error' in calendars) return { error: calendars.error, revoked: false } as const
  return { calendars: calendars.items } as const
}

/** Estado propio. `discover=1` consulta Google para elegir calendarios; sin él solo lee la BD. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const session = await requireTenant(tenant)
    if ('error' in session) return session.error
    const { sb, connection } = await ownConnection(session.tenantId, session.userId)
    if (!connection) return NextResponse.json({ connected: false, selected: [], available: [] })

    const selected = await sb
      .from('google_connected_calendars')
      .select('id, external_calendar_id, calendar_name, role, time_zone, is_enabled, last_sync_at, last_error_code')
      .eq('tenant_id', session.tenantId)
      .eq('connection_id', connection.id)
      .eq('owner_user_id', session.userId)
      .order('role')
      .order('calendar_name')
    if (selected.error) throw selected.error

    let available: GoogleCalendarListItem[] = []
    if (req.nextUrl.searchParams.get('discover') === '1') {
      const discovery = await usableGoogleCalendars(session.tenantId, connection.refresh_token)
      if ('error' in discovery) {
        await sb
          .from('google_oauth_connections')
          .update({ status: discovery.revoked ? 'revocada' : 'error', last_error: discovery.error })
          .eq('tenant_id', session.tenantId)
          .eq('id', connection.id)
        return NextResponse.json(
          { error: discovery.error, reconnect: discovery.revoked, connected: !discovery.revoked },
          { status: discovery.revoked ? 409 : 502 }
        )
      }
      available = discovery.calendars
    }

    return NextResponse.json({
      connected: connection.status === 'conectada',
      accountEmail: connection.google_email,
      status: connection.status,
      lastSyncAt: connection.last_sync_at,
      lastError: connection.last_error,
      selected: selected.data ?? [],
      available,
    })
  } catch (error) {
    console.error('[api/google-calendar GET]', error)
    return NextResponse.json({ error: 'No se pudo consultar Google Calendar.' }, { status: 500 })
  }
}

/** Selecciona o cambia el rol de UN calendario validándolo primero contra la cuenta conectada. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const session = await requireTenant(tenant)
    if ('error' in session) return session.error
    const body = (await req.json().catch(() => ({}))) as { calendarId?: string; role?: CalendarRole }
    if (!body.calendarId || !['primary', 'conflict', 'read_only'].includes(body.role || '')) {
      return NextResponse.json({ error: 'Calendario y rol no válidos.' }, { status: 400 })
    }

    const { sb, connection } = await ownConnection(session.tenantId, session.userId)
    if (!connection) return NextResponse.json({ error: 'Conecta Google Calendar primero.' }, { status: 409 })
    const discovery = await usableGoogleCalendars(session.tenantId, connection.refresh_token)
    if ('error' in discovery) {
      await sb
        .from('google_oauth_connections')
        .update({ status: discovery.revoked ? 'revocada' : 'error', last_error: discovery.error })
        .eq('tenant_id', session.tenantId)
        .eq('id', connection.id)
      return NextResponse.json({ error: discovery.error, reconnect: discovery.revoked }, { status: 409 })
    }
    const calendar = discovery.calendars.find((item) => item.id === body.calendarId)
    if (!calendar)
      return NextResponse.json({ error: 'Ese calendario no pertenece a la cuenta conectada.' }, { status: 404 })

    if (body.role === 'primary') {
      const demote = await sb
        .from('google_connected_calendars')
        .update({ role: 'read_only' })
        .eq('tenant_id', session.tenantId)
        .eq('connection_id', connection.id)
        .eq('owner_user_id', session.userId)
        .eq('role', 'primary')
        .neq('external_calendar_id', calendar.id)
      if (demote.error) throw demote.error
    }

    const saved = await sb.from('google_connected_calendars').upsert(
      {
        tenant_id: session.tenantId,
        connection_id: connection.id,
        owner_user_id: session.userId,
        external_calendar_id: calendar.id,
        calendar_name: calendar.name,
        role: body.role,
        time_zone: calendar.timeZone,
        is_enabled: true,
        last_error_code: null,
      },
      { onConflict: 'tenant_id,connection_id,external_calendar_id' }
    )
    if (saved.error) throw saved.error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/google-calendar PUT]', error)
    return NextResponse.json({ error: 'No se pudo guardar el calendario.' }, { status: 500 })
  }
}

/** Sincronización manual del caller. Solo persiste inventario externo; nunca crea appointments. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const session = await requireTenant(tenant)
    if ('error' in session) return session.error
    const { sb, connection } = await ownConnection(session.tenantId, session.userId)
    if (!connection) return NextResponse.json({ error: 'Conecta Google Calendar primero.' }, { status: 409 })

    const calendars = await sb
      .from('google_connected_calendars')
      .select('id, external_calendar_id, sync_token')
      .eq('tenant_id', session.tenantId)
      .eq('connection_id', connection.id)
      .eq('owner_user_id', session.userId)
      .eq('is_enabled', true)
    if (calendars.error) throw calendars.error
    if (!calendars.data?.length) {
      return NextResponse.json({ error: 'Selecciona al menos un calendario antes de sincronizar.' }, { status: 409 })
    }

    const result = await recordSyncRun(
      sb,
      {
        tenantId: session.tenantId,
        provider: 'google_calendar',
        job: `google-calendar:${session.userId}`,
        trigger: 'manual',
      },
      () =>
        syncGoogleCalendars({
          sb,
          tenantId: session.tenantId,
          userId: session.userId,
          ownerEmail: connection.google_email,
          encryptedRefreshToken: connection.refresh_token,
          calendars: calendars.data,
        }),
      (sync) => ({
        rowsWritten: sync.eventsWritten,
        failures: sync.failures,
        detail: {
          calendarios: sync.calendars,
          completas: sync.fullSyncs,
          incrementales: sync.incrementalSyncs,
        },
      })
    )

    const connectionUpdate = await sb
      .from('google_oauth_connections')
      .update({
        status: result.reconnectRequired ? 'revocada' : result.failures.length > 0 ? 'error' : 'conectada',
        last_sync_at: result.failures.length > 0 ? connection.last_sync_at : new Date().toISOString(),
        last_error: result.failures[0] ?? null,
      })
      .eq('tenant_id', session.tenantId)
      .eq('id', connection.id)
      .eq('owner_user_id', session.userId)
    if (connectionUpdate.error) throw connectionUpdate.error

    return NextResponse.json(
      { ok: result.failures.length === 0, ...result },
      { status: result.failures.length ? 207 : 200 }
    )
  } catch (error) {
    if (error instanceof SyncBusyError) {
      return NextResponse.json({ error: 'Ya hay una sincronización de este calendario en curso.' }, { status: 409 })
    }
    const code = error instanceof Error && 'code' in error ? String(error.code) : ''
    if (code === 'oauth_revocado') {
      return NextResponse.json(
        { error: 'Google revocó la autorización. Vuelve a conectar la cuenta.' },
        { status: 409 }
      )
    }
    console.error('[api/google-calendar POST]', error)
    return NextResponse.json({ error: 'No se pudo sincronizar Google Calendar.' }, { status: 500 })
  }
}

/** Desconecta solo la cuenta del caller; el CASCADE elimina sus selecciones, no agendas. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const session = await requireTenant(tenant)
    if ('error' in session) return session.error
    const sb = serviceClient()
    const calendarId = req.nextUrl.searchParams.get('calendarId')
    if (calendarId) {
      const { connection } = await ownConnection(session.tenantId, session.userId)
      if (!connection) return NextResponse.json({ ok: true, removed: false })
      const removedCalendar = await sb
        .from('google_connected_calendars')
        .delete()
        .eq('tenant_id', session.tenantId)
        .eq('connection_id', connection.id)
        .eq('owner_user_id', session.userId)
        .eq('external_calendar_id', calendarId)
        .select('id')
      if (removedCalendar.error) throw removedCalendar.error
      return NextResponse.json({ ok: true, removed: (removedCalendar.data?.length ?? 0) > 0 })
    }
    const removed = await sb
      .from('google_oauth_connections')
      .delete()
      .eq('tenant_id', session.tenantId)
      .eq('provider', 'calendar')
      .eq('owner_user_id', session.userId)
      .select('id')
    if (removed.error) throw removed.error
    return NextResponse.json({ ok: true, disconnected: (removed.data?.length ?? 0) > 0 })
  } catch (error) {
    console.error('[api/google-calendar DELETE]', error)
    return NextResponse.json({ error: 'No se pudo desconectar Google Calendar.' }, { status: 500 })
  }
}
