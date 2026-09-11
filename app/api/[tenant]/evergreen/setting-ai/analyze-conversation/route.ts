import { NextRequest, NextResponse } from 'next/server'
import { analyzeConversation, modelFrom, type ConvMsg } from '@/lib/setting-ai/core'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada' }, { status: 503 })

  const b = await req.json().catch(() => ({}))
  const conv: ConvMsg[] = Array.isArray(b.conversation) ? b.conversation : []
  if (!conv.length) return NextResponse.json({ error: 'Conversación vacía' }, { status: 400 })
  const model = modelFrom(b.model || 'sonnet')
  try {
    const result = await analyzeConversation(conv, model)
    if (!result) return NextResponse.json({ error: 'No se pudo generar el análisis' }, { status: 500 })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
