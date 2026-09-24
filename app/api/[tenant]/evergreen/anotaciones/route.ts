import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Notas del equipo ancladas a una fecha, para marcar picos/valles en los gráficos (TrendChart).
// Se lee y se escribe con la sesión del usuario: la RLS de annotations (ver la migración) ya decide
// quién puede insertar/corregir/borrar, así que no hace falta repetir esa lógica de rol aquí.

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export type Annotation = {
  id: string
  date: string
  title: string
  description: string | null
  category: string | null
  created_by: string
  created_at: string
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const qs = req.nextUrl.searchParams
  const desde = qs.get('desde')
  const hasta = qs.get('hasta')
  if ((desde && !FECHA.test(desde)) || (hasta && !FECHA.test(hasta))) {
    return NextResponse.json({ error: 'Las fechas tienen que ir en formato YYYY-MM-DD' }, { status: 400 })
  }

  const sb = await createClient()
  let query = sb
    .from('annotations')
    .select('id, date, title, description, category, created_by, created_at')
    .eq('tenant_id', auth.tenantId)
    .order('date', { ascending: false })
  if (desde) query = query.gte('date', desde)
  if (hasta) query = query.lte('date', hasta)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message, requestId: auth.requestId }, { status: 500 })
  return NextResponse.json({ annotations: (data ?? []) as Annotation[], requestId: auth.requestId })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => ({}))
  const date: string = typeof body.date === 'string' ? body.date : ''
  const title: string = typeof body.title === 'string' ? body.title.trim() : ''
  const description: string | null = typeof body.description === 'string' ? body.description.trim() || null : null
  const category: string | null = typeof body.category === 'string' ? body.category.trim() || null : null

  if (!FECHA.test(date)) return NextResponse.json({ error: 'Fecha inválida (YYYY-MM-DD)' }, { status: 400 })
  if (!title || title.length > 200) return NextResponse.json({ error: 'Falta el título (máx. 200)' }, { status: 400 })
  if (description && description.length > 2000)
    return NextResponse.json({ error: 'La descripción es demasiado larga (máx. 2000)' }, { status: 400 })

  const sb = await createClient()
  const { data, error } = await sb
    .from('annotations')
    .insert({
      tenant_id: auth.tenantId,
      date,
      title,
      description,
      category,
      created_by: auth.userId,
    })
    .select('id, date, title, description, category, created_by, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message, requestId: auth.requestId }, { status: 500 })
  return NextResponse.json({ annotation: data as Annotation, requestId: auth.requestId }, { status: 201 })
}
