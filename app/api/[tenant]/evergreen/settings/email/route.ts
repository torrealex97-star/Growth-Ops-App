import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// ── Configuración › Emails › Configuración ──────────────────────────────────
// Identidad FUNCIONAL de envío (from_name/from_email/reply_to). Las credenciales
// NO viven aquí (§4/§32): siguen únicamente en Integraciones; este endpoint solo
// REPORTA su estado (conectado/fallback) para pintar el banner.
// El dominio del remitente se valida contra RESEND_FROM de la integración: si el
// tenant configura hola@otrodominio.com cuando su remitente verificado es de
// acme.com, se rechaza con mensaje claro (§6 — no inventar estados de verificación;
// solo comparamos con el dominio del remitente ya configurado en Integraciones).

function sbAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!t.administraTenant) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const sb = sbAdmin()

  const [{ data: settings }, cfg] = await Promise.all([
    sb.from('tenant_email_settings').select('*').eq('tenant_id', t.tenantId).maybeSingle(),
    import('@/lib/config').then((m) => m.getTenantConfig(t.tenantId, true)),
  ])

  const ownKey = !!cfg.RESEND_API_KEY
  const resendFrom = cfg.RESEND_FROM ?? process.env.RESEND_FROM ?? ''
  const fromMatch = resendFrom.match(/<([^>]+)>/) ?? [null, resendFrom]
  const providerDomain = fromMatch[1]?.split('@')[1] ?? null

  return NextResponse.json({
    settings: settings ?? { from_name: null, from_email: null, reply_to_email: null },
    provider: {
      connected: ownKey || !!process.env.RESEND_API_KEY,
      usingGlobalFallback: !ownKey && !!process.env.RESEND_API_KEY,
      providerDomain,
    },
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!t.administraTenant) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const fromName = body?.from_name != null ? String(body.from_name).trim().slice(0, 120) : null
    const fromEmail = body?.from_email != null ? String(body.from_email).trim().toLowerCase() : null
    const replyTo = body?.reply_to_email != null ? String(body.reply_to_email).trim().toLowerCase() : null

    if (fromEmail && !EMAIL_RE.test(fromEmail)) {
      return NextResponse.json({ error: 'Email remitente no válido' }, { status: 400 })
    }
    if (replyTo && !EMAIL_RE.test(replyTo)) {
      return NextResponse.json({ error: 'Reply-To no válido' }, { status: 400 })
    }

    // Regla de dominio (§6): el remitente debe pertenece al dominio de la
    // integración (RESEND_FROM en Integraciones). Evita enviar con dominios no
    // autorizados que Rebounce/Resend rechazarían en entrega.
    const { getTenantConfig } = await import('@/lib/config')
    const cfg = await getTenantConfig(t.tenantId, true)
    const resendFrom = cfg.RESEND_FROM ?? process.env.RESEND_FROM ?? ''
    const fm = resendFrom.match(/<([^>]+)>/) ?? [null, resendFrom]
    const providerDomain = fm[1]?.split('@')[1]?.toLowerCase() ?? null
    if (fromEmail && providerDomain && !fromEmail.endsWith(`@${providerDomain}`)) {
      return NextResponse.json(
        {
          error: `El remitente debe usar el dominio de tu integración (${providerDomain}). Verifica el dominio en Resend o cambia el remitente en Configuración › Integraciones.`,
        },
        { status: 400 }
      )
    }

    const sb = sbAdmin()
    const { error } = await sb.from('tenant_email_settings').upsert(
      {
        tenant_id: t.tenantId,
        from_name: fromName || null,
        from_email: fromEmail || null,
        reply_to_email: replyTo || null,
      },
      { onConflict: 'tenant_id' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      entity_type: 'tenant_email_settings',
      entity_id: t.tenantId,
      action: 'update',
      actor_user_id: t.userId,
      new_values: { from_name: fromName, from_email: fromEmail, reply_to_email: replyTo },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al guardar' }, { status: 500 })
  }
}
