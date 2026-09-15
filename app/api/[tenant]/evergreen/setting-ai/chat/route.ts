import { NextRequest, NextResponse } from 'next/server'
import { callText, modelFrom, toAgentMessages, ensureStartsUser, type ConvMsg } from '@/lib/setting-ai/core'
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
  const system: string = typeof b.system === 'string' ? b.system : ''
  const model = modelFrom(b.model)

  const messages = ensureStartsUser(
    toAgentMessages(conv),
    '(El lead acaba de entrar en el DM tras interactuar con tu contenido. Escribe tu primer mensaje de follow-up.)'
  )
  try {
    const text = await callText({ model, system, messages, max_tokens: 1000 })
    return NextResponse.json({ text })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
