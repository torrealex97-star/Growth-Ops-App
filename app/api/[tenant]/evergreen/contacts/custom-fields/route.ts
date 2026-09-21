import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Definiciones de campos personalizados de la subcuenta (§1 del brief de contactos).
// Solo admin/director gestiona el catálogo; el resto de roles lo LEE (para pintar los
// valores en la ficha y filtrar en la lista). service-role porque las policies de escritura
// son solo para el rol de plataforma y la app decide la edición por rol (estándar de la casa).

function sb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const { data, error } = await sb()
    .from('custom_field_defs')
    .select('*')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ defs: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!['admin', 'director'].includes(t.role || '')) {
    return NextResponse.json({ error: 'Solo admin/director pueden gestionar campos' }, { status: 403 })
  }

  const body = (await req.json()) as {
    label?: string
    field_type?: string
    field_key?: string
  }
  const label = (body.label ?? '').trim()
  const fieldType = body.field_type ?? 'text'
  if (!label || !['text', 'number', 'date', 'boolean'].includes(fieldType)) {
    return NextResponse.json({ error: 'Datos del campo inválidos' }, { status: 400 })
  }

  // field_key: slug estable derivado del label si no viene explícito (dedupe natural).
  const key =
    (body.field_key ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') ||
    label
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') ||
    `campo_${Date.now()}`

  const { data: maxRow } = await sb()
    .from('custom_field_defs')
    .select('sort_order')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: false })
    .limit(1)

  const { data: def, error } = await sb()
    .from('custom_field_defs')
    .insert({
      tenant_id: t.tenantId,
      field_key: key,
      label,
      field_type: fieldType,
      sort_order: (maxRow?.[0]?.sort_order ?? 0) + 1,
    })
    .select()
    .single()
  if (error) {
    const msg = error.code === '23505' ? 'Ya existe un campo con esa clave en esta subcuenta' : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json({ def })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!['admin', 'director'].includes(t.role || '')) {
    return NextResponse.json({ error: 'Solo admin/director pueden gestionar campos' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })

  // El trigger trg_cleanup_custom_field_values limpia los valores en contacts.custom_fields.
  const { error } = await sb().from('custom_field_defs').delete().eq('id', id).eq('tenant_id', t.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
