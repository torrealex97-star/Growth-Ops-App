import { NextRequest, NextResponse } from 'next/server'
import { requireCaller, callText, modelFrom, leadSystem, toLeadMessages, ensureStartsUser, type ConvMsg, type Persona } from '@/lib/setting-ai/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  if (!(await requireCaller())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada' }, { status: 503 })

  const b = await req.json().catch(() => ({}))
  const conv: ConvMsg[] = Array.isArray(b.conversation) ? b.conversation : []
  const persona: Persona = b.persona || {}
  const model = modelFrom(b.model)

  const messages = ensureStartsUser(
    toLeadMessages(conv),
    '(Acabas de abrir el DM. Escribe tu primer mensaje como lead, breve y natural.)'
  )
  try {
    const text = await callText({ model, system: leadSystem(persona), messages, max_tokens: 450 })
    return NextResponse.json({ text })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
