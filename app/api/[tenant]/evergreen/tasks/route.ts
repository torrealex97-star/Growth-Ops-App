import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCompanyProfile } from '@/lib/contracts/company'
import { sendTaskAssignedEmail } from '@/lib/email/resend'
import { requireTenant } from '@/lib/auth/requireTenant'

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
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  try {
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const { data: urow } = await sb.from('users').select('roles(key)').eq('id', t.userId).single()
    const role = (urow?.roles as { key?: string } | null)?.key || ''
    if (!['admin', 'director', 'manager'].includes(role)) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const body = await req.json()
    const inputs: TaskInput[] = Array.isArray(body?.tasks) ? body.tasks : [body]
    const clean = inputs
      .filter((task) => task && typeof task.title === 'string' && task.title.trim())
      .map((task) => ({
        title: task.title!.trim(),
        description: task.description?.toString().trim() || null,
        assignee_id: task.assignee_id || null,
        stage: task.stage || 'backlog',
        priority: task.priority || 'media',
        due_date: task.due_date || null,
        source: task.source || 'manual',
        created_by: t.userId,
        tenant_id: t.tenantId,
      }))
    if (!clean.length) return NextResponse.json({ error: 'Ninguna tarea válida' }, { status: 400 })

    const { data: created, error } = await sb.from('tasks').insert(clean).select('id, title, description, assignee_id, priority, due_date')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Aviso por email a cada responsable (correo de empresa). No bloquea la creación.
    let emailed = 0
    const assignees = Array.from(new Set((created ?? []).map((c) => c.assignee_id).filter(Boolean))) as string[]
    if (assignees.length) {
      const [{ data: users }, company] = await Promise.all([
        sb.from('users').select('id, full_name, email').in('id', assignees),
        getCompanyProfile(sb),
      ])
      const byId = new Map((users ?? []).map((u) => [u.id, u]))
      const base = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin
      for (const c of created ?? []) {
        if (!c.assignee_id) continue
        const u = byId.get(c.assignee_id)
        if (!u?.email) continue
        const r = await sendTaskAssignedEmail({
          to: u.email,
          assigneeName: u.full_name || 'equipo',
          company,
          taskTitle: c.title,
          taskDescription: c.description,
          dueDate: c.due_date,
          priority: c.priority,
          url: `${base}/${tenant}/tasks`,
        })
        if (r.ok) emailed++
      }
    }

    return NextResponse.json({ ok: true, created: created?.length ?? 0, emailed })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
