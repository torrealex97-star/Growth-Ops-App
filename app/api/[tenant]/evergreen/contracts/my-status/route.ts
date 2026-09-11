import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// Estado del contrato de equipo del usuario logueado. Se usa para bloquear el
// acceso al panel a closer/setter/afiliado que aún no han firmado.
// Necesita el service role porque la RLS de `contracts` no deja a esos roles
// leer la tabla (solo la lee liderazgo/csm/gestoría).
export async function GET() {
  try {
    const authed = await createServerClient()
    const { data: { user: me } } = await authed.auth.getUser()
    if (!me) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

    const sb = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    const { data } = await sb
      .from('contracts')
      .select('status, signing_token, created_at')
      .eq('user_id', me.id)
      .eq('kind', 'equipo')
      .order('created_at', { ascending: false })

    const list = (data ?? []) as { status: string; signing_token: string | null }[]
    const hasSigned = list.some((c) => c.status === 'firmado')
    const pending = list.find((c) => c.status !== 'firmado' && c.signing_token)

    return NextResponse.json({
      hasSigned,
      hasContract: list.length > 0,
      pendingToken: pending?.signing_token ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
