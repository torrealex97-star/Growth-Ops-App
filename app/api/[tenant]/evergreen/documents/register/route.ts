import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

// Cliente construido dentro del handler (no a nivel de módulo): crearlo al importar el módulo
// rompía el build entero si NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no estaban
// disponibles en ese momento (p.ej. Vercel Preview sin esas env vars) — "supabaseUrl is required".
function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function getUserRole(supabase: ReturnType<typeof serviceClient>, userId: string): Promise<string | null> {
  const { data } = await supabase.from('users').select('role_id').eq('id', userId).single()
  if (!data?.role_id) return null
  const { data: role } = await supabase.from('roles').select('key').eq('id', data.role_id).single()
  return role?.key || null
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'

function isValidDni(raw: string): boolean {
  const v = raw.trim().toUpperCase()
  const m = v.match(/^(\d{8})([A-Z])$/)
  if (!m) return false
  const [, digits, letter] = m
  return DNI_LETTERS[Number(digits) % 23] === letter
}

function isValidNie(raw: string): boolean {
  const v = raw.trim().toUpperCase()
  const m = v.match(/^([XYZ])(\d{7})([A-Z])$/)
  if (!m) return false
  const prefixMap: Record<string, string> = { X: '0', Y: '1', Z: '2' }
  const [, prefix, digits, letter] = m
  const num = Number(prefixMap[prefix] + digits)
  return DNI_LETTERS[num % 23] === letter
}

// Registra el documento de identidad del alumno (tipo + número, sin foto) y decide si pasa la
// verificación: DNI/NIE se validan por checksum; "otro" es el cortafuegos, siempre pasa; pasaporte
// solo exige que haya un número escrito (no hay checksum estándar universal).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const supabase = serviceClient()

    const { saleId, documentType, documentNumber } = await req.json()
    if (!saleId || !documentType) {
      return NextResponse.json({ error: 'Falta la venta o el tipo de documento' }, { status: 400 })
    }
    if (!['dni', 'pasaporte', 'nie', 'otro'].includes(documentType)) {
      return NextResponse.json({ error: 'Tipo de documento no válido' }, { status: 400 })
    }

    const userRole = await getUserRole(supabase, t.userId)
    const allowedRoles = ['admin', 'director', 'closer']
    if (!userRole || !allowedRoles.includes(userRole)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { data: sale } = await supabase
      .from('sales')
      .select('id')
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .single()
    if (!sale) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

    const number = String(documentNumber ?? '').trim()

    if (documentType === 'dni' && !isValidDni(number)) {
      return NextResponse.json({ error: 'El DNI no es válido (formato: 12345678A)' }, { status: 400 })
    }
    if (documentType === 'nie' && !isValidNie(number)) {
      return NextResponse.json({ error: 'El NIE no es válido (formato: X1234567A)' }, { status: 400 })
    }
    if (documentType === 'pasaporte' && number.length < 5) {
      return NextResponse.json({ error: 'Escribe el número de pasaporte' }, { status: 400 })
    }
    // 'otro' no se valida: es el cortafuegos para no bloquear el envío del contrato.

    const { error: updateError } = await supabase
      .from('sales')
      .update({
        student_document_type: documentType,
        student_document_number: number || null,
        documents_verified: true,
        documents_verified_at: new Date().toISOString(),
        documents_verified_by: t.userId,
      })
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    try {
      await supabase.from('audit_logs').insert({
        tenant_id: t.tenantId,
        action: 'document_verification_register',
        entity_type: 'sale',
        entity_id: saleId,
        new_values: { documentType, timestamp: new Date().toISOString(), actor: t.userId },
      })
    } catch {
      // No fallar si no existe la tabla
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
