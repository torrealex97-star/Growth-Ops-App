import { NextRequest, NextResponse } from 'next/server'
import { getClient, modelFrom, DEFAULT_MODEL, buildImprovePrompt, type Correction } from '@/lib/setting-ai/core'
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
  const basePrompt: string = typeof b.basePrompt === 'string' ? b.basePrompt : ''
  const corrections: Correction[] = Array.isArray(b.corrections) ? b.corrections : []
  const transcriptNotes: string = typeof b.transcriptNotes === 'string' ? b.transcriptNotes : ''
  const model = modelFrom(b.model)
  const { system, user } = buildImprovePrompt(basePrompt, corrections, transcriptNotes)

  const client = getClient()
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
      const runWith = async (m: string) => {
        const ms = client.messages.stream({
          model: m,
          max_tokens: 14000,
          system,
          temperature: 0.4,
          messages: [{ role: 'user', content: user }],
        })
        ms.on('text', (t: string) => send({ type: 'token', text: t }))
        await ms.finalMessage()
      }
      try {
        try {
          await runWith(model)
        } catch (e) {
          if (model !== DEFAULT_MODEL) {
            await runWith(DEFAULT_MODEL)
          } else {
            throw e
          }
        }
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
