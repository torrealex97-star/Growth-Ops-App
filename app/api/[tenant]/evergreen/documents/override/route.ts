import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

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

export async function POST(req: NextRequest) {
  try {
    // El usuario se determina SIEMPRE desde la sesión autenticada (cookies),
    // nunca desde el body — antes se confiaba en un userId enviado por el
    // cliente (incluso hardcodeado a 'current_user'), lo que rompía el
    // override y además permitía suplantar a cualquier usuario.
    const authed = await createServerClient()
    const { data: { user: me } } = await authed.auth.getUser()
    if (!me) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const data = await req.json()
    const { saleId, reason } = data
    const userId = me.id

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

    // Validar que la venta exista
    const { data: sale } = await supabase
      .from('sales')
      .select('id')
      .eq('id', saleId)
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
