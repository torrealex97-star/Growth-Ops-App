import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  try {
    const saleId = new URL(req.url).searchParams.get('saleId')
    if (!saleId) {
      return NextResponse.json({ error: 'Missing saleId' }, { status: 400 })
    }

    // Obtener estado de documentos de la venta (de esta subcuenta)
    const { data: sale, error } = await supabase
      .from('sales')
      .select(
        `
        id,
        documents_verified,
        documents_verified_at,
        documents_verified_by,
        documents_verified_override,
        documents_override_reason,
        documents_override_by,
        documents_override_at,
        student_document_type,
        student_document_number
      `
      )
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .single()

    if (error || !sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    // Si la venta tiene documents_verified_by, obtener el nombre del usuario
    let verifiedByUser = null
    if (sale.documents_verified_by) {
      const { data: user } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', sale.documents_verified_by)
        .single()
      verifiedByUser = user
    }

    let overrideByUser = null
    if (sale.documents_override_by) {
      const { data: user } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', sale.documents_override_by)
        .single()
      overrideByUser = user
    }

    return NextResponse.json({
      documents_verified: sale.documents_verified,
      documents_verified_at: sale.documents_verified_at,
      documents_verified_by: verifiedByUser,
      documents_verified_override: sale.documents_verified_override,
      documents_override_reason: sale.documents_override_reason,
      documents_override_by: overrideByUser,
      documents_override_at: sale.documents_override_at,
      student_document_type: sale.student_document_type,
      student_document_number: sale.student_document_number,
    })
  } catch (error) {
    console.error('Document state error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
