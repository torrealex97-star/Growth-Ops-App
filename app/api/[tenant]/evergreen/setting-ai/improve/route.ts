import { NextRequest, NextResponse } from 'next/server'
import { callText, modelFrom, buildImprovePrompt, type Correction } from '@/lib/setting-ai/core'
import { requireTenant } from '@/lib/auth/requireTenant'
import { tenantAiEnv } from '@/lib/ai/provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const aiEnv = await tenantAiEnv(t.tenantId)

  const b = await req.json().catch(() => ({}))
  const basePrompt: string = typeof b.basePrompt === 'string' ? b.basePrompt : ''
  const corrections: Correction[] = Array.isArray(b.corrections) ? b.corrections : []
  const transcriptNotes: string = typeof b.transcriptNotes === 'string' ? b.transcriptNotes : ''
  const model = modelFrom(b.model)
  const { system, user } = buildImprovePrompt(basePrompt, corrections, transcriptNotes)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`))
        } catch {
          /* closed */
        }
      }
      try {
        // Se mantiene el contrato SSE de la pantalla. El proveedor común resuelve DeepSeek o
        // Anthropic por subcuenta; enviar el resultado en un bloque también funciona para clientes
        // que ya concatenan eventos `token`, sin mantener dos implementaciones de streaming.
        const text = await callText(
          { model, system, messages: [{ role: 'user', content: user }], max_tokens: 14000, temperature: 0.4 },
          aiEnv
        )
        send({ type: 'token', text })
        send({ type: 'done' })
      } catch (e) {
        send({ type: 'error', error: (e as Error).message })
        send({ type: 'done' })
      } finally {
        try {
          controller.close()
        } catch {
          /* closed */
        }
      }
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
