import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const maxDuration = 30
import { buildAIContext } from '@/lib/sheets'
import type { DashboardData } from '@/lib/types'

export async function POST(req: NextRequest) {
  try {
    const { messages, context } = (await req.json()) as {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>
      context: DashboardData
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Se requieren mensajes' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const dataContext = context ? buildAIContext(context) : 'No hay datos disponibles.'

    const systemPrompt = `Eres un analista experto en marketing y ventas para "IA WINNERS", un programa de formación en ventas/closing lanzado en mayo 2026 por una emprendedora española.

Tu función es ayudar a la dueña del negocio a entender los datos de su lanzamiento y tomar decisiones estratégicas.

DATOS ACTUALES DEL LANZAMIENTO:
${dataContext}

INSTRUCCIONES:
- Responde siempre en español, de forma clara y directa
- Sé conciso pero informativo — no des respuestas genéricas
- Cuando cites datos, usa los números exactos del contexto
- Si te preguntan por el mejor anuncio, mira la campaña con más leads Y mayor % de encuesta
- Ofrece insights accionables cuando sea relevante
- El evento es el 6 de mayo de 2026
- Usa formato con saltos de línea cuando sea útil para claridad
- No uses asteriscos para negrita, usa mayúsculas o guiones para énfasis`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      stream: true,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of response) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
              )
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Error desconocido'
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Error al procesar la solicitud',
        detail: error instanceof Error ? error.message : String(error),
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
