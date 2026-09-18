import { NextRequest, NextResponse } from 'next/server'
import { getTestimonioUser } from '@/lib/testimonios-auth'
import { createTestimonio, listTestimonios } from '@/lib/testimonios'
import { parseTestimonioBody } from '@/lib/testimonios-payload'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const user = await getTestimonioUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    // Los que pueden editar ven también los desactivados, para poder reactivarlos.
    const testimonios = await listTestimonios(user.canWrite, t.tenantId)
    return NextResponse.json({ testimonios, canWrite: user.canWrite })
  } catch (err) {
    console.error('[api/testimonios GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const user = await getTestimonioUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    if (!user.canWrite) return NextResponse.json({ error: 'Sin permiso para crear testimonios' }, { status: 403 })

    const body = await req.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })

    const parsed = parseTestimonioBody(body)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

    const testimonio = await createTestimonio({ ...parsed.patch, name }, t.tenantId)
    return NextResponse.json({ testimonio })
  } catch (err) {
    console.error('[api/testimonios POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
