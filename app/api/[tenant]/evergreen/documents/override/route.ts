import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper: obtener el rol del usuario autenticado
async function getUserRole(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('users')
    .select('role_id')
    .eq('id', userId)
    .single()

  if (!data?.role_id) return null

  const { data: role } = await supabase
    .from('roles')
    .select('key')
    .eq('id', data.role_id)
    .single()

  return role?.key || null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    // El usuario y el tenant se determinan SIEMPRE desde la sesión autenticada
    // (cookies) + la membresía de la subcuenta — nunca desde el body — antes se
    // confiaba en un userId enviado por el cliente (incluso hardcodeado a
    // 'current_user'), lo que rompía el override y además permitía suplantar a
    // cualquier usuario.
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const data = await req.json()
    const { saleId, reason } = data
    const userId = t.userId

    if (!saleId || !reason) {
      return NextResponse.json(
        { error: 'Missing required fields: saleId, reason' },
        { status: 400 }
      )
    }

    // Validar permisos: solo admin, director, closer
    const userRole = await getUserRole(userId)
    const allowedRoles = ['admin', 'director', 'closer']

    if (!userRole || !allowedRoles.includes(userRole)) {
      return NextResponse.json(
        { error: 'Unauthorized: insufficient permissions' },
        { status: 403 }
      )
    }

    // Validar que la venta exista (y pertenezca a esta subcuenta)
    const { data: sale } = await supabase
      .from('sales')
      .select('id')
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .single()

    if (!sale) {
      return NextResponse.json(
        { error: 'Sale not found' },
        { status: 404 }
      )
    }

    // Aplicar override
    const { error: updateError } = await supabase
      .from('sales')
      .update({
        documents_verified_override: true,
        documents_override_reason: reason,
        documents_override_by: userId,
        documents_override_at: new Date().toISOString(),
        // Marcar como verificado para permitir envío de contrato
        documents_verified: true,
        documents_verified_at: new Date().toISOString(),
        documents_verified_by: userId
      })
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)

    if (updateError) {
      console.error('Override update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to apply override' },
        { status: 500 }
      )
    }

    // Registrar en audit log (si existe la tabla)
    try {
      await supabase
        .from('audit_logs')
        .insert({
          tenant_id: t.tenantId,
          action: 'document_verification_override',
          target_table: 'sales',
          target_id: saleId,
          user_id: userId,
          details: {
            reason,
            timestamp: new Date().toISOString()
          }
        })
    } catch {
      // No fallar si no existe la tabla
    }

    return NextResponse.json({
      success: true,
      message: `Document verification overridden by ${userRole}. Sale can now proceed to contract sending.`,
      sale_id: saleId
    })
  } catch (error) {
    console.error('Document override error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
