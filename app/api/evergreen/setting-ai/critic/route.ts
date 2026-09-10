import { NextRequest, NextResponse } from 'next/server'
import { requireCaller, critique, modelFrom, type ConvMsg } from '@/lib/setting-ai/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  if (!(await requireCaller())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY no configurada' }, { status: 503 })

  const b = await req.json().catch(() => ({}))
  const conv: ConvMsg[] = Array.isArray(b.conversation) ? b.conversation : []
  const model = modelFrom(b.criticModel || 'haiku')
  try {
    const result = await critique(conv, model)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
