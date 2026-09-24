import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { abrirTicket, cookieNombre } from '@/lib/auth/ver-como'

export const runtime = 'nodejs'

// GET — estado del modo "ver como" para ESTA subcuenta. El ticket es httpOnly: el navegador no
// puede leer su contenido, así que el banner pregunta aquí. Solo expone lo que el banner pinta
// (nombre, email, caducidad) — jamás tokens. Requiere sesión en la subcuenta (cualquier miembro
// la puede llamar: solo contesta "activo: false" si no hay modo). Además informa si el QUE
// LLAMA es super admin, para pintar los botones "Ver como" sin una llamada extra.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return NextResponse.json({ activo: false, superadmin: false })

  const t = abrirTicket(req.cookies.get(cookieNombre())?.value)
  const activo = t.ok && t.ticket.tenant === tenant
  return NextResponse.json({
    activo,
    superadmin: auth.isSuperAdmin,
    ...(activo ? { nombre: t.ticket.objetivo.nombre, email: t.ticket.objetivo.email, expira: t.ticket.exp } : {}),
  })
}
