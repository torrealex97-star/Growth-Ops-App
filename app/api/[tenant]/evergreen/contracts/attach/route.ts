import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const BUCKET = 'contratos'
const ALLOWED_ROLES = new Set(['admin', 'director', 'manager', 'csm'])
const MAX_BYTES = 15 * 1024 * 1024

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    if (!t.role || !ALLOWED_ROLES.has(t.role) || !t.administraTenant) {
      return NextResponse.json({ error: 'No tienes permiso para adjuntar contratos' }, { status: 403 })
    }

    const form = await req.formData()
    const contractId = String(form.get('contractId') ?? '').trim()
    const file = form.get('file')
    const signedAtRaw = String(form.get('signedAt') ?? '').trim()
    const signerName = String(form.get('signerName') ?? '').trim()
    if (!contractId || !(file instanceof File)) {
      return NextResponse.json({ error: 'Faltan el contrato o el archivo PDF' }, { status: 400 })
    }
    if (file.type !== 'application/pdf' || file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'El archivo debe ser un PDF de hasta 15 MB' }, { status: 400 })
    }

    const signedAt = signedAtRaw ? new Date(signedAtRaw) : new Date()
    if (Number.isNaN(signedAt.getTime())) {
      return NextResponse.json({ error: 'La fecha de firma no es válida' }, { status: 400 })
    }

    const sb = serviceClient()
    const { data: contract, error: contractError } = await sb
      .from('contracts')
      .select('id, tenant_id, kind, user_id, signer_data')
      .eq('id', contractId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (contractError || !contract) return NextResponse.json({ error: 'Contrato no encontrado' }, { status: 404 })

    const path = `${contract.id}.pdf`
    const upload = await sb.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: 'application/pdf',
      upsert: true,
    })
    if (upload.error)
      return NextResponse.json({ error: `No se pudo guardar el PDF: ${upload.error.message}` }, { status: 500 })

    const priorSignerData = (contract.signer_data ?? {}) as Record<string, unknown>
    const { error: updateError } = await sb
      .from('contracts')
      .update({
        status: 'firmado',
        signed_at: signedAt.toISOString(),
        signed_pdf_url: path,
        signer_name: signerName || null,
        signer_data: {
          ...priorSignerData,
          source: 'firmado_externamente',
          attached_by: t.userId,
          attached_at: new Date().toISOString(),
        },
      })
      .eq('id', contract.id)
      .eq('tenant_id', t.tenantId)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    if (contract.kind === 'equipo' && contract.user_id) {
      await sb
        .from('collaborator_profiles')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('tenant_id', t.tenantId)
        .eq('user_id', contract.user_id)
        .in('status', ['invited', 'pending_contract'])
    }

    await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      entity_type: 'contract',
      entity_id: contract.id,
      action: 'attach_external_signed_contract',
      new_values: {
        source: 'firmado_externamente',
        signed_at: signedAt.toISOString(),
        attached_by: t.userId,
        kind: contract.kind,
      },
    })

    return NextResponse.json({ ok: true, contractId: contract.id, status: 'firmado' })
  } catch (error) {
    console.error('[contracts/attach]', error)
    return NextResponse.json({ error: 'No se pudo adjuntar el contrato' }, { status: 500 })
  }
}
