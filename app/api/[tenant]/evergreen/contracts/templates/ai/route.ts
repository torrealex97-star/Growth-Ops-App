import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { contractVariablesFromText } from '@/lib/ai/claude'

export const runtime = 'nodejs'
export const maxDuration = 60

// Recibe texto de contrato pegado y devuelve el mismo texto con las variables
// {{...}} insertadas donde corresponda (para crear plantillas más rápido).
export async function POST(req: NextRequest) {
  try {
    const authed = await createClient()
    const { data: { user: me } } = await authed.auth.getUser()
    if (!me) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: row } = await authed.from('users').select('roles(key)').eq('id', me.id).maybeSingle()
    const role = (row?.roles as { key?: string } | null)?.key
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
