import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { tenantActiveUsers } from '@/lib/users'
import { completeText, tenantAiEnv } from '@/lib/ai/provider'
import { requireTenant } from '@/lib/auth/requireTenant'

export const maxDuration = 60

// Recibe una transcripción y devuelve TAREAS PROPUESTAS (no las inserta).
// El usuario las revisa/edita en la UI y confirma antes de crearlas.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    // Requiere sesión: usa service-role + LLM de pago, no puede ser anónimo.
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { transcript } = await req.json()
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length < 20) {
      return NextResponse.json({ error: 'Transcripción demasiado corta' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'Falta ANTHROPIC_API_KEY' }, { status: 500 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    // Solo el equipo de ESTA subcuenta: mandar al modelo los nombres de los usuarios de otras
    // subcuentas es filtrar datos personales a un tercero.
    const users = await tenantActiveUsers(sb, t.tenantId)
    const roster = users.map((u) => u.full_name).join(', ')

    // Por el motor configurado en Integraciones (DeepSeek si la subcuenta lo tiene puesto, Anthropic
    // si no). Antes fijaba a mano un modelo concreto, así que ni respetaba esa elección ni se
    // enteraba cuando ese modelo dejaba de existir.
    const { text } = await completeText(
      {
        system:
          'Eres un asistente que extrae tareas accionables de la transcripción de una reunión de un equipo de ventas. ' +
          'Devuelve EXCLUSIVAMENTE un JSON válido con esta forma: ' +
          '{"summary": string, "tasks": [{"title": string, "description": string, "assignee_name": string|null, "stage": string|null}]}. ' +
          `Asigna cada tarea a una de estas personas si se menciona o se deduce (usa el nombre EXACTO de la lista o null): ${roster || 'sin equipo'}. ` +
          'Sé conciso. No inventes tareas que no estén en la reunión. Responde en español.',
        user: `Transcripción:\n\n${transcript.slice(0, 50000)}`,
        maxTokens: 2000,
        smart: true,
      },
      await tenantAiEnv(t.tenantId)
    )
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return NextResponse.json({ error: 'La IA no devolvió tareas válidas' }, { status: 502 })
    const parsed = JSON.parse(jsonMatch[0]) as {
      summary?: string
      tasks?: { title: string; description?: string; assignee_name?: string | null; stage?: string | null }[]
    }

    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
    const proposals = (parsed.tasks || []).map((t) => {
      const match = t.assignee_name
        ? users.find(
            (u) =>
              norm(u.full_name) === norm(t.assignee_name!) ||
              norm(u.full_name).startsWith(norm(t.assignee_name!.split(' ')[0]))
          )
        : null
      return {
        title: t.title,
        description: t.description || '',
        stage: t.stage || null,
        assignee_id: match?.id || null,
        assignee_name: match?.full_name || t.assignee_name || null,
      }
    })

    return NextResponse.json({ summary: parsed.summary || '', proposals })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error interno' }, { status: 500 })
  }
}
