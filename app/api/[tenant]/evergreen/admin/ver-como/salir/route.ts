import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { abrirTicket, cookieNombre } from '@/lib/auth/ver-como'

export const runtime = 'nodejs'

function svc(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// POST — salir del "ver como": canjea el refresh token GUARDADO del super admin (el ticket) por una
// sesión nueva y la escribe en las cookies. Después borra el ticket. Si el ticket caducó (30 min),
// la sesión original ya no se puede restaurar por este camino: el super admin vuelve a entrar por
// el login normal (es el mismo caso que una sesión caducada cualquiera).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const ticket = abrirTicket(req.cookies.get(cookieNombre())?.value)
  if (!ticket.ok) {
    const res = NextResponse.json(
      { error: `El ticket ya no sirve (${ticket.motivo}); entra de nuevo con tu usuario.`, motivo: ticket.motivo },
      { status: 400 }
    )
    res.cookies.delete(cookieNombre())
    return res
  }
  const t = ticket.ticket
  if (t.tenant !== tenant) {
    return NextResponse.json({ error: 'El ticket no corresponde a esta subcuenta' }, { status: 400 })
  }

  // Canje del refresh token guardado. Estando dentro "como otro", las cookies actuales SON del
  // objetivo: por eso el canje se hace con un cliente limpio (sin cookies) y el resultado se
  // escribe explícitamente.
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await anon.auth.refreshSession({ refresh_token: t.superAdmin.refresh_token })
  if (error || !data.session) {
    const res = NextResponse.json(
      { error: 'No se pudo restaurar tu sesión (caducó). Entra de nuevo con tu usuario.', motivo: 'refresh_fallido' },
      { status: 400 }
    )
    res.cookies.delete(cookieNombre())
    return res
  }
  const s = data.session

  // AUDITORÍA de la salida (quién entró como quién ya está registrado; esto cierra el círculo).
  // audit_logs.tenant_id es NOT NULL: sin resolver el slug a UUID el insert fallaba SIEMPRE
  // (y el try/catch anterior no lo veía — supabase-js no lanza, devuelve { error }).
  const svcClient = svc()
  const { data: tenantRow } = await svcClient.from('tenants').select('id').eq('slug', tenant).maybeSingle()
  const { error: auditErr } = await svcClient.from('audit_logs').insert({
    tenant_id: tenantRow?.id ?? null,
    actor_user_id: t.superAdmin.user_id,
    entity_type: 'ver_como',
    entity_id: t.objetivo.userId,
    action: 'salir',
    new_values: { tenant },
  })
  if (auditErr) console.error('[ver-como/salir] no se pudo registrar en audit_logs:', auditErr.message)

  // La sesión se escribe con el adaptador SSR canónico de @supabase/ssr, el MISMO que lee el cliente
  // del navegador. Antes se fabricaba a mano una cookie única y HttpOnly: el navegador no podía leerla,
  // la UI creía que no había sesión y devolvía al login (F21). El adaptador además parte la sesión en
  // trozos `.0`, `.1`… si es grande y borra los trozos de la sesión anterior (getAll les da la cookie
  // actual del "ver como" para que setAll sepa cuáles retirar).
  const res = NextResponse.json({ ok: true })
  const ssr = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (aEscribir) => aEscribir.forEach(({ name, value, options }) => res.cookies.set(name, value, options)),
    },
  })
  const { error: sessionErr } = await ssr.auth.setSession({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
  })
  if (sessionErr) {
    const fallo = NextResponse.json(
      { error: 'No se pudo restaurar tu sesión. Entra de nuevo con tu usuario.', motivo: 'sesion_no_escrita' },
      { status: 400 }
    )
    fallo.cookies.delete(cookieNombre())
    return fallo
  }
  res.cookies.delete(cookieNombre())
  return res
}
