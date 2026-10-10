/**
 * Gestión de conexiones MCP desde la app (pantalla Configuración → Conexiones IA).
 *
 * GET: lista los clientes OAuth cuyo dueño es el usuario con sesión y sus sesiones (tokens)
 *      emitidos, con estado vivo/revocado/caducado calculado en servidor.
 * POST: { action: 'revocar_sesion', tokenId } revoca UNA sesión; { action: 'revocar_cliente',
 *      clientId } revoca TODAS las sesiones del cliente y borra el cliente.
 *
 * La autorización es doble: requireTenant valida sesión+tenant, y las funciones de store
 * filtran por owner_user_id — un id ajeno llega pero no produce cambios. service_role solo
 * se usa dentro de store; el cliente anon/RLS no toca estas tablas de gestión.
 */
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { listarClientesDeUsuario, listarSesionesDeUsuario, revocarCliente, revocarSesion } from '@/lib/mcp/store'

export const runtime = 'nodejs'

async function userIdActual(): Promise<string | null> {
  const cookieStore = await cookies()
  const authed = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll() {},
    },
  })
  const {
    data: { user },
  } = await authed.auth.getUser()
  return user?.id ?? null
}

function estadoSesion(row: {
  expires_at: string
  revoked_at: string | null
  refresh_expires_at: string | null
}): 'activa' | 'revocada' | 'caducada' {
  if (row.revoked_at) return 'revocada'
  const ahora = Date.now()
  if (new Date(row.expires_at).getTime() < ahora) {
    // Sin refresh vivo no hay forma de renovar: caducada de verdad.
    if (!row.refresh_expires_at || new Date(row.refresh_expires_at).getTime() < ahora) return 'caducada'
    return 'activa' // el access token rotó; la sesión sigue renovándose con su refresh
  }
  return 'activa'
}

export async function GET() {
  const userId = await userIdActual()
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  try {
    const [clientes, sesiones] = await Promise.all([listarClientesDeUsuario(userId), listarSesionesDeUsuario(userId)])
    return NextResponse.json(
      {
        clientes: clientes.map((c) => ({ ...c, redirect_uris: c.redirect_uris })),
        sesiones: sesiones.map((s) => ({ ...s, estado: estadoSesion(s) })),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error leyendo las conexiones MCP'
    return NextResponse.json({ error: mensaje }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const userId = await userIdActual()
  if (!userId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: { action?: unknown; tokenId?: unknown; clientId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  try {
    if (body.action === 'revocar_sesion') {
      if (typeof body.tokenId !== 'string' || !body.tokenId) {
        return NextResponse.json({ error: 'Falta tokenId' }, { status: 400 })
      }
      const revocada = await revocarSesion(userId, body.tokenId)
      if (!revocada) {
        // No existe, no es de un cliente propio o ya estaba revocada: mismo veredicto, sin revelar cuál.
        return NextResponse.json({ error: 'Sesión no encontrada' }, { status: 404 })
      }
      return NextResponse.json({ ok: true })
    }
    if (body.action === 'revocar_cliente') {
      if (typeof body.clientId !== 'string' || !body.clientId) {
        return NextResponse.json({ error: 'Falta clientId' }, { status: 400 })
      }
      const revocado = await revocarCliente(userId, body.clientId)
      if (!revocado) {
        return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 })
      }
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Acción no soportada' }, { status: 400 })
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error revocando'
    return NextResponse.json({ error: mensaje }, { status: 500 })
  }
}
