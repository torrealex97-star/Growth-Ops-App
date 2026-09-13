import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { PROVISION_STEPS, validateTenantInput } from '@/lib/tenants/blueprint'
import { provisionTenant, tenantsReadiness } from '@/lib/tenants/provision'

export const runtime = 'nodejs'

// Alta de subcuentas (fase J del plan).
//
// SOLO super admin de plataforma. No basta con ser admin de una subcuenta: crear subcuentas es una
// operación de plataforma, y un admin de cliente que pudiera crearlas se daría acceso a sí mismo a
// una subcuenta nueva sin que nadie lo autorizara.
//
// La ruta cuelga de una subcuenta (`/api/[tenant]/evergreen/...`) a propósito: así la sesión se
// resuelve con el mismo `requireTenant` que el resto y no hay un segundo camino de autenticación que
// mantener. El `tenant` de la URL es solo el sitio DESDE el que se administra; lo que se crea es otra
// subcuenta distinta.

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireSuperAdmin(tenantSlug: string) {
  const session = await requireTenant(tenantSlug)
  if ('error' in session) return session
  if (!session.isSuperAdmin) {
    return { error: NextResponse.json({ error: 'Solo el super admin de plataforma puede ver esto' }, { status: 403 }) }
  }
  return session
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireSuperAdmin(tenant)
  if ('error' in session) return session.error

  try {
    return NextResponse.json({ steps: PROVISION_STEPS, tenants: await tenantsReadiness(serviceClient()) })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudieron leer las subcuentas' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireSuperAdmin(tenant)
  if ('error' in session) return session.error

  const body = (await req.json().catch(() => ({}))) as { slug?: unknown; name?: unknown; accent?: unknown }
  const validated = validateTenantInput(body)
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 })

  try {
    const result = await provisionTenant(serviceClient(), validated.input, {
      userId: session.userId,
      tenantId: session.tenantId,
    })
    // Un fallo de aprovisionamiento se devuelve con 409/500 según qué pasó, y siempre con el motivo:
    // "no se pudo crear" sin decir por qué obliga a mirar la base de datos a mano.
    if (!result.ok) {
      return NextResponse.json(result, { status: result.motivo === 'slug_ocupado' ? 409 : 500 })
    }
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo crear la subcuenta' },
      { status: 500 }
    )
  }
}
