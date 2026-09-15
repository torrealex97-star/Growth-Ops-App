import { NextRequest, NextResponse } from 'next/server'
import {
  callText,
  modelFrom,
  DEFAULT_MODEL,
  leadSystem,
  toLeadMessages,
  toAgentMessages,
  ensureStartsUser,
  critique,
  autoPersona,
  buildImprovePrompt,
  liveSystem,
  type ConvMsg,
  type Persona,
  type Correction,
} from '@/lib/setting-ai/core'
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
  const notes: string = typeof b.transcriptNotes === 'string' ? b.transcriptNotes : ''
  const chatModel = modelFrom(b.model || 'sonnet')
  const leadModel = modelFrom(b.leadModel || 'haiku')
  const criticModel = modelFrom(b.criticModel || 'haiku')
  const numConvos = Math.min(Math.max(parseInt(b.numConvos) || 3, 1), 8)
  const turns = Math.min(Math.max(parseInt(b.turns) || 5, 2), 12)
  const personasIn: Persona[] | null = Array.isArray(b.personas) && b.personas.length ? b.personas : null

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
      const autoCorr: (Correction & { convo: number; severidad: string; auto: boolean })[] = []
      const threads: { persona: Persona; conversation: ConvMsg[] }[] = []

      try {
        send({ type: 'start', numConvos, turns })
        for (let ci = 0; ci < numConvos; ci++) {
          const persona = personasIn ? personasIn[ci % personasIn.length] : autoPersona(ci)
          const conversation: ConvMsg[] = []
          send({ type: 'convo-start', convo: ci, persona })

          for (let t = 0; t < turns; t++) {
            // 1) Lead simulado
            const leadMsgs = ensureStartsUser(
              toLeadMessages(conversation),
              '(Acabas de abrir el DM. Escribe tu primer mensaje como lead, breve y natural.)'
            )
            const leadText = await callText(
              {
                model: leadModel,
                system: leadSystem(persona),
                messages: leadMsgs,
                max_tokens: 400,
              },
              aiEnv
            )
            conversation.push({ who: 'lead', text: leadText })
            send({ type: 'lead', convo: ci, turn: t, text: leadText })

            // 2) Agente con correcciones ya aplicadas
            const sys = liveSystem(basePrompt, autoCorr)
            const agentText = await callText(
              {
                model: chatModel,
                system: sys,
                messages: toAgentMessages(conversation),
                max_tokens: 700,
              },
              aiEnv
            )
            conversation.push({ who: 'agent', text: agentText })
            send({ type: 'agent', convo: ci, turn: t, text: agentText })

            // 3) Crítico + autocorrección
            const crit = await critique(conversation, criticModel, aiEnv)
            send({ type: 'critic', convo: ci, turn: t, ok: crit.ok, issues: crit.issues })
            for (const iss of crit.issues || []) {
              if (iss.severidad === 'baja') continue
              const corr = {
                convo: ci,
                leadMsg: [...conversation].reverse().find((m) => m.who === 'lead')?.text || '',
                agentMsg: agentText,
                note: `[${iss.severidad}] ${iss.regla}: ${iss.nota}`,
                better: iss.better || '',
                auto: true,
                severidad: iss.severidad,
              }
              autoCorr.push(corr)
              send({ type: 'correction', convo: ci, correction: corr, total: autoCorr.length })
            }
          }
          threads.push({ persona, conversation })
          send({ type: 'convo-end', convo: ci })
        }

        // 4) Prompt mejorado con todo lo aprendido
        send({ type: 'improving', corrections: autoCorr.length })
        let improved = ''
        if (autoCorr.length) {
          const { system, user } = buildImprovePrompt(basePrompt, autoCorr, notes)
          try {
            improved = await callText(
              {
                model: chatModel,
                system,
                messages: [{ role: 'user', content: user }],
                max_tokens: 14000,
                temperature: 0.4,
              },
              aiEnv
            )
          } catch {
            improved = await callText(
              {
                model: DEFAULT_MODEL,
                system,
                messages: [{ role: 'user', content: user }],
                max_tokens: 14000,
                temperature: 0.4,
              },
              aiEnv
            )
          }
        } else {
          improved =
            '(El auto-entrenamiento no detectó fallos que corregir. El prompt actual aguantó bien esta tanda 💪)'
        }
        send({ type: 'done', threads, corrections: autoCorr, improved })
      } catch (e) {
        send({ type: 'error', message: (e as Error).message })
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
