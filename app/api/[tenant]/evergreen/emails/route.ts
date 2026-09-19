import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { sendEmail } from '@/lib/email/service'
import { getCompanyProfile } from '@/lib/contracts/company'
import { TEMPLATE_SKELETONS } from '@/lib/email/templates'
import type { EmailTemplateKey } from '@/lib/email/templates'

export const runtime = 'nodejs'

// ── Configuración › Emails › Historial + Enviar prueba ──────────────────────
// GET  → historial paginado con filtros (estado, plantilla, destinatario).
// POST → email de PRUEBA: renderiza la plantilla con datos ficticios y la envía
//        al email indicado. NO ejecuta ningún flujo de negocio (no crea
//        contratos, usuarios ni tareas) — solo llama a EmailService con
//        is_test: true, que queda marcado en el historial (§14).

const KEYS = new Set(Object.keys(TEMPLATE_SKELETONS))
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

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

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const templateKey = url.searchParams.get('template')
  const to = url.searchParams.get('to')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200)

  let q = sb
    .from('email_messages')
    .select(
      'id, template_key, to_email, subject, status, is_test, error_message, created_at, sent_at, delivered_at, opened_at, bounced_at, provider_message_id'
    )
    .eq('tenant_id', t.tenantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (status) q = q.eq('status', status)
  if (templateKey) q = q.eq('template_key', templateKey)
  if (to) q = q.ilike('to_email', `%${to}%`)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ messages: data ?? [] })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  try {
    const body = await req.json()
    const templateKey = String(body?.template_key ?? '')
    const to = String(body?.to ?? '')
      .trim()
      .toLowerCase()
    if (!KEYS.has(templateKey)) return NextResponse.json({ error: 'Plantilla desconocida' }, { status: 400 })
    if (!EMAIL_RE.test(to)) return NextResponse.json({ error: 'Email de prueba no válido' }, { status: 400 })

    const sb = sbAdmin()
    const company = await getCompanyProfile(sb, t.tenantId)
    const result = await sendEmail({
      tenantId: t.tenantId,
      templateKey: templateKey as EmailTemplateKey,
      recipient: to,
      recipientName: 'María García',
      url: 'https://ejemplo.com/enlace-de-prueba',
      welcome: 'Te damos la bienvenida. Revisa y acepta las condiciones para continuar.',
      task: {
        title: 'Llamada de seguimiento (prueba)',
        description: 'Email de prueba — no es una tarea real.',
        priority: 'Alta',
      },
      isTest: true,
      company,
    })

    return NextResponse.json({ ok: result.ok, error: result.error, usedGlobalFallback: result.usedGlobalFallback })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error al enviar la prueba' },
      { status: 500 }
    )
  }
}
