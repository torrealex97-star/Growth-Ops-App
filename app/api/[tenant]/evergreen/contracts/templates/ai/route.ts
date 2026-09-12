import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { contractVariablesFromText } from '@/lib/ai/claude'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 60

// Recibe texto de contrato pegado y devuelve el mismo texto con las variables
// {{...}} insertadas donde corresponda (para crear plantillas más rápido).
// No toca ninguna tabla con tenant_id (solo llama a la IA), pero se exige
// requireTenant igualmente para que solo miembros de esta subcuenta la usen.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const authed = await createClient()
    const role = t.role
    if (!['admin', 'director'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const { text } = (await req.json()) as { text?: string }
    if (!text?.trim()) return NextResponse.json({ error: 'Falta el texto' }, { status: 400 })

    const body = await contractVariablesFromText(text)
    return NextResponse.json({ ok: true, body })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
