import { NextRequest, NextResponse } from 'next/server'
import { getTestimonioUser } from '@/lib/testimonios-auth'
import { deleteTestimonio, getTestimonio, updateTestimonio } from '@/lib/testimonios'
import { parseTestimonioBody } from '@/lib/testimonios-payload'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await ctx.params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const user = await getTestimonioUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const testimonio = await getTestimonio(id, t.tenantId)
    if (!testimonio) return NextResponse.json({ error: 'Testimonio no encontrado' }, { status: 404 })
    return NextResponse.json({ testimonio, canWrite: user.canWrite })
  } catch (err) {
    console.error('[api/testimonios/id GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await ctx.params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const user = await getTestimonioUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    if (!user.canWrite) return NextResponse.json({ error: 'Sin permiso para editar' }, { status: 403 })

    const parsed = parseTestimonioBody(await req.json().catch(() => ({})))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    if (!Object.keys(parsed.patch).length) return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })

    const testimonio = await updateTestimonio(id, parsed.patch, t.tenantId)
    if (!testimonio) return NextResponse.json({ error: 'Testimonio no encontrado' }, { status: 404 })
    return NextResponse.json({ testimonio })
  } catch (err) {
    console.error('[api/testimonios/id PATCH]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await ctx.params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const user = await getTestimonioUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    if (!user.canWrite) return NextResponse.json({ error: 'Sin permiso para eliminar' }, { status: 403 })
    await deleteTestimonio(id, t.tenantId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[api/testimonios/id DELETE]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
