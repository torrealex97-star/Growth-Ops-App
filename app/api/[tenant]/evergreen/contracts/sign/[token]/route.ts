import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { buildContractPdf } from '@/lib/contracts/pdf'
import { getCompanyProfile } from '@/lib/contracts/company'
import { applyVars, signerVars, stripRemainingVars, SIGNER_FIELDS, type ContractTerms, type SignerData } from '@/lib/contracts/terms'
import { sendSignedContractEmail } from '@/lib/email/resend'

export const runtime = 'nodejs'

const BUCKET = 'contratos'

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Ruta PÚBLICA (la firma el colaborador sin sesión, solo con el token de firma):
// no usamos requireTenant (exige login) — resolvemos el tenant por slug y acotamos
// la búsqueda del contrato por tenant_id como defensa en profundidad, ya que el
// token de firma en sí (aleatorio, único) es el mecanismo de seguridad principal.
async function resolveTenantId(sb: SupabaseClient, tenantSlug: string): Promise<string | null> {
  const { data } = await sb.from('tenants').select('id, status').eq('slug', tenantSlug).eq('status', 'active').maybeSingle()
  return data?.id ?? null
}

// Sube el PDF firmado a Supabase Storage (bucket público, se crea si no existe)
// y devuelve su URL pública estable.
async function uploadSignedPdf(sb: SupabaseClient, contractId: string, bytes: Uint8Array): Promise<string> {
  const path = `${contractId}.pdf`
  const body = Buffer.from(bytes)
  let up = await sb.storage.from(BUCKET).upload(path, body, { contentType: 'application/pdf', upsert: true })
  if (up.error && /bucket.*not.*found|not found/i.test(up.error.message)) {
    await sb.storage.createBucket(BUCKET, { public: true })
    up = await sb.storage.from(BUCKET).upload(path, body, { contentType: 'application/pdf', upsert: true })
  }
  if (up.error) throw new Error(`No se pudo guardar el PDF: ${up.error.message}`)
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

// GET — datos del contrato para la página pública de firma (por token).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string; token: string }> }) {
  const { tenant, token } = await params
  const sb = service()
  const tenantId = await resolveTenantId(sb, tenant)
  if (!tenantId) return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })
  const { data } = await sb
    .from('contracts')
    .select('id, title, body_snapshot, terms, status, signer_name, signer_data, signed_at, signed_pdf_url, user_id')
    .eq('signing_token', token)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!data) return NextResponse.json({ error: 'Contrato no encontrado' }, { status: 404 })

  const company = await getCompanyProfile(sb, tenantId)

  // Prefill de datos del firmante con lo que ya sepamos del miembro.
  let memberName: string | null = null
  const prefill: SignerData = (data.signer_data as SignerData) ?? {}
  if (data.user_id) {
    const { data: u } = await sb.from('users').select('full_name, phone, dni, address').eq('id', data.user_id).maybeSingle()
    memberName = u?.full_name ?? null
    if (u) {
      prefill.dni = prefill.dni ?? u.dni ?? null
      prefill.address = prefill.address ?? u.address ?? null
      prefill.phone = prefill.phone ?? u.phone ?? null
    }
  }

  return NextResponse.json({
    id: data.id,
    title: data.title,
    body: data.body_snapshot,
    terms: data.terms,
    status: data.status,
    memberName,
    company: {
      name: company.name,
      representative: company.representative,
      cif: company.cif,
      address: [company.address, company.postal_code, company.city].filter(Boolean).join(', ') || null,
    },
    signerFields: SIGNER_FIELDS,
    signerPrefill: prefill,
    signerName: data.signer_name,
    signedAt: data.signed_at,
    signedPdfUrl: data.signed_pdf_url,
  })
}

// POST — el colaborador firma: valida consentimiento, genera el PDF (con la
// firma fija de la empresa), lo guarda en Blob y marca el contrato como firmado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; token: string }> }) {
  try {
    const { tenant, token } = await params
    const { signerName, consent, signerData } = (await req.json()) as {
      signerName?: string
      consent?: boolean
      signerData?: SignerData
    }
    if (!signerName?.trim() || !consent) {
      return NextResponse.json({ error: 'Falta el nombre completo o el consentimiento' }, { status: 400 })
    }
    // Valida los campos obligatorios que debe completar el firmante.
    const sd: SignerData = signerData ?? {}
    const missing = SIGNER_FIELDS.filter((f) => f.required && !String(sd[f.key] ?? '').trim())
    if (missing.length) {
      return NextResponse.json({ error: `Faltan datos: ${missing.map((m) => m.label).join(', ')}` }, { status: 400 })
    }

    const sb = service()
    const tenantId = await resolveTenantId(sb, tenant)
    if (!tenantId) return NextResponse.json({ error: 'Subcuenta no encontrada' }, { status: 404 })
    const { data: c } = await sb
      .from('contracts')
      .select('id, title, body_snapshot, terms, status, created_by, user_id')
      .eq('signing_token', token)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!c) return NextResponse.json({ error: 'Contrato no encontrado' }, { status: 404 })
    if (c.status === 'firmado') {
      return NextResponse.json({ error: 'Este contrato ya está firmado' }, { status: 409 })
    }

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      null
    const ua = req.headers.get('user-agent')
    const signedAt = new Date().toISOString()
    const terms = (c.terms ?? {}) as ContractTerms

    // Quién dio el alta (para dejar constancia en el PDF).
    let createdByName: string | null = null
    if (c.created_by) {
      const { data: u } = await sb.from('users').select('full_name').eq('id', c.created_by).maybeSingle()
      createdByName = u?.full_name ?? null
    }

    // Cuerpo final: 2ª pasada sustituyendo las variables del firmante y limpiando
    // cualquier variable restante para que el PDF no muestre {{...}}.
    const company = await getCompanyProfile(sb, tenantId)
    const finalBody = stripRemainingVars(applyVars(c.body_snapshot ?? '', signerVars(sd)))

    // Hash de integridad del contenido firmado.
    const hash = createHash('sha256')
      .update(JSON.stringify({ id: c.id, body: finalBody, terms, sd, signerName, signedAt }))
      .digest('hex')

    const pdfBytes = await buildContractPdf({
      title: c.title ?? 'Contrato',
      bodyText: finalBody,
      terms,
      company,
      signerName: signerName.trim(),
      signerData: sd,
      signedAtISO: signedAt,
      signerIp: ip,
      createdByName,
      contractId: c.id,
      hash,
    })

    // Guardar el PDF firmado en Supabase Storage (bucket público, URL estable).
    const url = await uploadSignedPdf(sb, c.id, pdfBytes)

    const { error } = await sb
      .from('contracts')
      .update({
        status: 'firmado',
        signed_at: signedAt,
        signer_name: signerName.trim(),
        signer_data: sd,
        signer_ip: ip,
        signer_user_agent: ua,
        signed_hash: hash,
        signed_pdf_url: url,
        url,
      })
      .eq('id', c.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Persistir en el miembro los datos que completó (para futuros contratos).
    let memberName: string | null = null
    let memberEmail: string | null = null
    let memberPersonalEmail: string | null = null
    if (c.user_id) {
      const { data: mu } = await sb.from('users').select('full_name, email, personal_email').eq('id', c.user_id).maybeSingle()
      memberName = mu?.full_name ?? null
      memberEmail = mu?.email ?? null
      memberPersonalEmail = mu?.personal_email ?? null
      const patch: Record<string, string> = {}
      if (sd.dni) patch.dni = sd.dni
      if (sd.address) patch.address = sd.address
      if (sd.phone) patch.phone = sd.phone
      if (Object.keys(patch).length) await sb.from('users').update(patch).eq('id', c.user_id)
    }

    // Enviar una copia del contrato firmado al correo de empresa y (cc) al
    // personal. El personal puede venir del usuario o de las condiciones del
    // propio contrato (terms.personal_email).
    const personalEmail = memberPersonalEmail || (terms as { personal_email?: string | null }).personal_email || null
    const primary = memberEmail || personalEmail
    if (primary) {
      await sendSignedContractEmail({
        to: primary,
        cc: memberEmail ? personalEmail : null,
        memberName: memberName || signerName.trim(),
        company,
        pdfUrl: url,
        pdfBytes,
      })
    }

    await sb.from('audit_logs').insert({
      tenant_id: tenantId,
      entity_type: 'contract',
      entity_id: c.id,
      action: 'update',
      new_values: { status: 'firmado', signer_name: signerName.trim(), hash, ip },
    })

    return NextResponse.json({ ok: true, signedPdfUrl: url })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
