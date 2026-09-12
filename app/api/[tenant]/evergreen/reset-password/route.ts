import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { requireTenant } from '@/lib/auth/requireTenant'

// Reset de contraseña por admin: genera una contraseña temporal al instante
// (sin depender del email de Supabase). SOLO admin/director pueden llamarlo.

function genTempPassword(): string {
  // 3 grupos de 6 chars alfanuméricos legibles → p.ej. "k7f2ab-9qm4xz-3rt8wp"
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(18)
  let out = ''
  for (let i = 0; i < 18; i++) {
    if (i > 0 && i % 6 === 0) out += '-'
    out += alphabet[bytes[i] % alphabet.length]
  }
  return out
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const { userId } = await req.json()
    if (!userId) {
      return NextResponse.json({ error: 'Falta userId' }, { status: 400 })
    }

    // 1) Verificar que quien llama está autenticado y administra ESTA subcuenta
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const callerRole = t.role
    if (!t.isSuperAdmin && callerRole !== 'admin' && callerRole !== 'director') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    // 2) SEGURIDAD: `users` no tiene tenant_id, así que sin esta comprobación un admin de ESTA
    // subcuenta podría resetear la contraseña de CUALQUIER usuario de la plataforma (de otra
    // subcuenta) con solo conocer su userId. Verificamos que el objetivo sea miembro de esta
    // subcuenta (o que el que llama sea super_admin).
    if (!t.isSuperAdmin) {
      const { data: targetMembership } = await admin
        .from('tenant_members')
        .select('id')
        .eq('tenant_id', t.tenantId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!targetMembership) {
        return NextResponse.json({ error: 'El usuario no pertenece a esta subcuenta' }, { status: 403 })
      }
    }

    // 3) Con service role: fijar la contraseña temporal
    const tempPassword = genTempPassword()
    const { error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true, tempPassword })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
