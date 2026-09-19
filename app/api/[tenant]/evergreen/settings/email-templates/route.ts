import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { TEMPLATE_SKELETONS, expandSkeletonDirectives, defaultSubject, defaultBody } from '@/lib/email/templates'
import type { EmailTemplateKey, EmailVars } from '@/lib/email/templates'
import { getCompanyProfile } from '@/lib/contracts/company'

export const runtime = 'nodejs'

// Plantillas de email de la subcuenta (Configuración › Correos).
// GET  → estado de las 8: cuál tiene override, cuál usa el default (y su contenido).
// PUT  → guarda/actualiza el override de una plantilla (upsert) con auditoría.
// DELETE se expone vía PUT con `restaurar: true`: borrar la fila = volver al default.

// Las claves válidas son las del catálogo — nunca confiar en un template_key del cliente.
const KEYS = new Set(Object.keys(TEMPLATE_SKELETONS))

function sbAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const sb = sbAdmin()
  const [{ data: overrides }, company] = await Promise.all([
    sb
      .from('email_templates')
      .select('template_key, subject, body_html, updated_at, updated_by')
      .eq('tenant_id', t.tenantId),
    getCompanyProfile(sb, t.tenantId),
  ])
  const byKey = new Map((overrides ?? []).map((r) => [r.template_key, r]))

  // Vars de muestra SOLO para devolver el default renderizado de referencia.
  const sample: EmailVars = { company }

  const templates = Object.entries(TEMPLATE_SKELETONS).map(([key, sk]) => {
    const ov = byKey.get(key)
    return {
      key: key as EmailTemplateKey,
      personalizada: !!ov,
      subject: ov?.subject ?? defaultSubject(key as EmailTemplateKey, sample),
      body_html: ov?.body_html ?? defaultBody(key as EmailTemplateKey, sample),
      skeleton: { subject: sk.subject, body: sk.body },
      updated_at: ov?.updated_at ?? null,
      updated_by: ov?.updated_by ?? null,
    }
  })

  return NextResponse.json({ templates })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  try {
    const body = await req.json()
    const key = String(body?.template_key || '')
    if (!KEYS.has(key)) return NextResponse.json({ error: 'Plantilla desconocida' }, { status: 400 })

    const sb = sbAdmin()

    // Restaurar default = borrar el override (la ausencia de fila ES el default).
    if (body?.restaurar) {
      const { error } = await sb.from('email_templates').delete().eq('tenant_id', t.tenantId).eq('template_key', key)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      await sb.from('audit_logs').insert({
        tenant_id: t.tenantId,
        entity_type: 'email_template',
        entity_id: key,
        action: 'update',
        actor_user_id: t.userId,
        new_values: { restaurado: true },
      })
      return NextResponse.json({ ok: true, restaurada: true })
    }

    const subject = String(body?.subject ?? '').trim()
    // Los esqueletos traen directivas {{boton:…}}: se expanden a HTML puro antes de guardar.
    const rawBody = String(body?.body_html ?? '')
    const bodyHtml = expandSkeletonDirectives(rawBody).trim()
    if (!subject || !bodyHtml) {
      return NextResponse.json({ error: 'Asunto y cuerpo son obligatorios' }, { status: 400 })
    }
    if (subject.length > 300 || bodyHtml.length > 60_000) {
      return NextResponse.json({ error: 'Plantilla demasiado grande' }, { status: 413 })
    }

    const { error } = await sb.from('email_templates').upsert(
      {
        tenant_id: t.tenantId,
        template_key: key,
        subject,
        body_html: bodyHtml,
        updated_by: t.userId,
      },
      { onConflict: 'tenant_id,template_key' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      entity_type: 'email_template',
      entity_id: key,
      action: 'update',
      actor_user_id: t.userId,
      old_values: body?.anterior
        ? { subject: String(body.anterior.subject || ''), body_html: String(body.anterior.body_html || '') }
        : null,
      new_values: { subject, body_html: bodyHtml },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error al guardar la plantilla' },
      { status: 500 }
    )
  }
}
