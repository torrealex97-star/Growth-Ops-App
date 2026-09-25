import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Borrar una anotación: la RLS (annotations_delete_own_or_admin) ya limita esto a su autor o a
// admin/director, así que un intento sin permiso vuelve con 0 filas afectadas, no con un error.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const sb = await createClient()
  const { data, error } = await sb
    .from('annotations')
    .delete()
    .eq('id', id)
    .eq('tenant_id', auth.tenantId)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message, requestId: auth.requestId }, { status: 500 })
  if (!data)
    return NextResponse.json(
      { error: 'No existe o no tienes permiso para borrarla', requestId: auth.requestId },
      { status: 404 }
    )
  return NextResponse.json({ ok: true, requestId: auth.requestId })
}
