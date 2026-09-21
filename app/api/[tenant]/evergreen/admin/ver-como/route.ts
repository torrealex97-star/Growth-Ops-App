import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { cookieNombre, sellarTicket } from '@/lib/auth/ver-como'

export const runtime = 'nodejs'

function svc(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// POST { userId } — prepara "ver como" para ese usuario de esta subcuenta:
//   1. Guarda en una cookie cifrada (ticket) la sesión REAL del super admin.
//   2. Genera un enlace mágico de login (admin.generateLink magiclink) para el usuario objetivo.
//   3. Devuelve la URL: el navegador del super admin la visita, Supabase sustituye la sesión,
//      y a partir de ahí TODO lo que ve es exactamente lo que ve el colaborador (RLS incluida).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  // Quién puede iniciar "Ver como": el super admin de plataforma (cualquier subcuenta) o el admin
  // de ESTA subcuenta (solo usuarios de la suya — el ticket va ligado al tenant y el objetivo se
  // valida contra users/tenant_members de aquí abajo, así que un admin no puede cruzar de subcuenta).
  // Un director/manager no: ver el panel DE OTRO como él mismo excede su rol.
  if (!auth.isSuperAdmin && auth.administraTenant !== true && auth.role !== 'admin') {
    return NextResponse.json(
      { error: 'Solo el super admin de la plataforma o el admin de la subcuenta pueden usar Ver como' },
      { status: 403 }
    )
  }

  const body = (await req.json().catch(() => ({}))) as { userId?: string }
  const userId = (body.userId || '').trim()
  if (!userId) return NextResponse.json({ error: 'Falta el usuario' }, { status: 400 })
  if (userId === auth.userId) return NextResponse.json({ error: 'Ya estás en tu propia sesión' }, { status: 400 })

  const sb = svc()
  // El objetivo tiene que ser miembro de ESTA subcuenta: es la frontera que impide a un admin
  // suplantar a alguien de otra. El super admin podría suplantar a cualquiera, pero el catálogo
  // de la pantalla ya filtra por subcuenta — y el ticket va firmado con ESTA subcuenta.
  const { data: membresiaObj, error: eMem } = await sb
    .from('tenant_members')
    .select('id')
    .eq('tenant_id', auth.tenantId)
    .eq('user_id', userId)
    .maybeSingle()
  if (eMem) return NextResponse.json({ error: eMem.message }, { status: 500 })
  if (!membresiaObj && !auth.isSuperAdmin) {
    return NextResponse.json({ error: 'Ese usuario no pertenece a esta subcuenta' }, { status: 403 })
  }
  const { data: objetivo, error: eObj } = await sb
    .from('users')
    .select('id, email, full_name, is_active')
    .eq('id', userId)
    .maybeSingle()
  if (eObj) return NextResponse.json({ error: eObj.message }, { status: 500 })
  const filas = objetivo as {
    id: string
    email: string | null
    full_name: string | null
    is_active: boolean | null
  } | null
  if (!filas) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  if (filas.is_active === false) return NextResponse.json({ error: 'El usuario está desactivado' }, { status: 400 })

  // Leer la sesión actual del super admin DE SUS COOKIES (server-side). requireTenant ya validó
  // que hay usuario; aquí necesito los tokens crudos para poder devolvérselos luego.
  const cookieStore = req.cookies
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/^https:\/\//, '').split('.')[0]
  const cruda = cookieStore.get(`sb-${ref}-auth-token`)?.value || ''
  if (!cruda.startsWith('base64-')) {
    return NextResponse.json({ error: 'No se pudo leer la sesión actual para guardarla' }, { status: 400 })
  }
  let sesionSuper: { access_token: string; refresh_token: string; expires_at: number; user_id: string }
  try {
    const parsed = JSON.parse(Buffer.from(cruda.slice('base64-'.length), 'base64').toString('utf8')) as {
      access_token?: string
      refresh_token?: string
      expires_at?: number
      user?: { id?: string }
    }
    if (!parsed.access_token || !parsed.refresh_token || !parsed.user?.id) throw new Error('forma')
    sesionSuper = {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_at: parsed.expires_at ?? 0,
      user_id: parsed.user.id,
    }
    if (sesionSuper.user_id !== auth.userId) throw new Error('desajuste')
  } catch {
    return NextResponse.json({ error: 'Sesión no reconocida; vuelve a entrar y reintenta' }, { status: 400 })
  }

  // Enlace mágico para el objetivo. El action_link de Supabase trae la sesión en el #fragment
  // (nunca llega al server) y aterriza en el Site URL del proyecto — por eso NO devolvemos ese
  // link: devolvemos NUESTRA página intermedia con el token, que canjea en el navegador
  // (setSession → cookies SSR) y redirige al panel. El token viaja solo entre Supabase y el
  // navegador del admin, y se consume en el primer uso.
  const site = (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, '')
  const gen = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email: filas.email || '',
    options: { redirectTo: `${site}/ver-como/entrar?tenant=${tenant}` },
  })
  if (gen.error || !gen.data?.properties?.action_link) {
    return NextResponse.json(
      {
        error: gen.error?.message?.includes('not found')
          ? 'El usuario no tiene login de Supabase con ese email'
          : gen.error?.message || 'No se pudo generar el enlace',
      },
      { status: 400 }
    )
  }

  const ticket = sellarTicket({
    tenant,
    superAdmin: sesionSuper,
    objetivo: { userId: filas.id, email: filas.email, nombre: filas.full_name },
  })

  // Nuestra página (no el action_link): ella canjea el OTP en el navegador y entra al panel.
  const uEnlace = new URL(gen.data.properties.action_link)
  const token = uEnlace.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Enlace sin token' }, { status: 400 })
  const urlLocal = new URL(`${site}/ver-como/entrar`)
  urlLocal.searchParams.set('tenant', tenant)
  urlLocal.searchParams.set('token', token)
  if (filas.email) urlLocal.searchParams.set('email', filas.email)

  const res = NextResponse.json({ url: urlLocal.toString() })
  res.cookies.set(cookieNombre(), ticket, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 60,
  })
  return res
}
