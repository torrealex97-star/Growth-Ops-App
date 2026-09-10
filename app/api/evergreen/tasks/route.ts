import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getCompanyProfile } from '@/lib/contracts/company'
import { sendTaskAssignedEmail } from '@/lib/email/resend'

export const runtime = 'nodejs'

type TaskInput = {
  title?: string
  description?: string | null
  assignee_id?: string | null
  stage?: string | null
  priority?: string | null
  due_date?: string | null
  source?: string | null
}

// Crea una o varias tareas (service role) y avisa por email a cada responsable.
// Solo admin/director (coincide con la RLS de INSERT de `tasks`).
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies()
    const authed = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await authed.auth.getUser()
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    if (!['admin', 'director', 'manager'].includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const body = await req.json()
    const inputs: TaskInput[] = Array.isArray(body?.tasks) ? body.tasks : [body]
    const clean = inputs
      .filter((t) => t && typeof t.title === 'string' && t.title.trim())
      .map((t) => ({
        title: t.title!.trim(),
        description: t.description?.toString().trim() || null,
        assignee_id: t.assignee_id || null,
        stage: t.stage || 'backlog',
        priority: t.priority || 'media',
        due_date: t.due_date || null,
        source: t.source || 'manual',
        created_by: user.id,
      }))
    if (!clean.length) return NextResponse.json({ error: 'Ninguna tarea válida' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: created, error } = await sb.from('tasks').insert(clean).select('id, title, description, assignee_id, priority, due_date')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Aviso por email a cada responsable (correo de empresa). No bloquea la creación.
    let emailed = 0
    const assignees = Array.from(new Set((created ?? []).map((t) => t.assignee_id).filter(Boolean))) as string[]
    if (assignees.length) {
      const [{ data: users }, company] = await Promise.all([
        sb.from('users').select('id, full_name, email').in('id', assignees),
        getCompanyProfile(sb),
      ])
      const byId = new Map((users ?? []).map((u) => [u.id, u]))
      const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin
      for (const t of created ?? []) {
        if (!t.assignee_id) continue
        const u = byId.get(t.assignee_id)
        if (!u?.email) continue
        const r = await sendTaskAssignedEmail({
          to: u.email,
          assigneeName: u.full_name || 'equipo',
          company,
          taskTitle: t.title,
          taskDescription: t.description,
          dueDate: t.due_date,
          priority: t.priority,
          url: `${base}/evergreen/tasks`,
        })
        if (r.ok) emailed++
      }
    }

    return NextResponse.json({ ok: true, created: created?.length ?? 0, emailed })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
