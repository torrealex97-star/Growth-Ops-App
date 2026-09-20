import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { crearContratoEquipo } from '@/lib/contracts/team-contract'
import type { ContractTerms } from '@/lib/contracts/terms'
import { resendConfigured } from '@/lib/email/resend'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'

// Crea un contrato de EQUIPO listo para firmar y (si Resend está configurado)
// lo envía automáticamente por email al colaborador con la plantilla de la empresa.
//  · el ROL es seleccionable (roleKey/roleLabel) e independiente del rol del user.
//  · las condiciones (terms) llegan ya confirmadas/editadas desde la UI.
//  · registra quién da el alta (created_by = usuario logueado).
// La lógica vive en lib/contracts/team-contract.ts, compartida con la cadena
// automática del alta de colaboradores. Aquí el admin FUERZA la creación
// (force: true) aunque ya exista otro contrato: es un reenvío consciente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const {
      userId,
      templateId,
      title,
      terms,
      roleKey,
      roleLabel,
      personalEmail: rawPersonalEmail,
    } = (await req.json()) as {
      userId?: string
      templateId?: string | null
      title?: string
      terms?: ContractTerms
      roleKey?: string | null
      roleLabel?: string | null
      personalEmail?: string | null
    }
    if (!userId || !terms) {
      return NextResponse.json({ error: 'Faltan userId o condiciones (terms)' }, { status: 400 })
    }
    const rawTrimmed = rawPersonalEmail?.trim() || null
    const angle = rawTrimmed?.match(/<([^>]+)>/)
    const providedPersonalEmail = (angle ? angle[1] : rawTrimmed)?.trim().toLowerCase() || null
    if (providedPersonalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(providedPersonalEmail)) {
      return NextResponse.json({ error: `El correo personal "${providedPersonalEmail}" no es válido` }, { status: 400 })
    }

    const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const result = await crearContratoEquipo({
      sb,
      tenantId: t.tenantId,
      userId,
      createdBy: t.userId,
      baseUrl: process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin,
      roleKey,
      roleLabel,
      templateId,
      title,
      terms,
      personalEmail: rawPersonalEmail,
      force: true,
    })
    if (!result.ok) return NextResponse.json({ error: result.error ?? 'No se pudo crear el contrato' }, { status: 500 })

    return NextResponse.json({
      ok: true,
      contractId: result.contractId,
      token: result.token,
      signUrl: result.signUrl,
      emailed: result.emailed,
      emailError: result.emailError,
      resendConfigured: resendConfigured(await getTenantConfigWithFallback(t.tenantId)),
      memberEmail: result.memberEmail,
      personalEmail: result.personalEmail,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
