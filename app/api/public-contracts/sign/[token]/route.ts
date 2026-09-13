import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { buildContractPdf } from '@/lib/contracts/pdf'
import { getCompanyProfile } from '@/lib/contracts/company'
import {
  applyVars,
  signerVars,
  stripRemainingVars,
  SIGNER_FIELDS,
  type ContractTerms,
  type SignerData,
} from '@/lib/contracts/terms'
import { sendSignedContractEmail } from '@/lib/email/resend'

export const runtime = 'nodejs'

const BUCKET = 'contratos'

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Ruta PÚBLICA (la firma el colaborador sin sesión, solo con el token de firma) y NO anidada
// bajo /api/[tenant]/... porque la página /firmar/[token] no conoce el tenant (solo el token).
// El tenant se resuelve leyendo el contrato por `signing_token`, que tiene índice UNIQUE global
// (20260910110000_restore_original_features.sql) — el token en sí (aleatorio, único) es el
// mecanismo de seguridad principal, no la subcuenta.
async function requireActiveTenant(sb: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await sb.from('tenants').select('id').eq('id', tenantId).eq('status', 'active').maybeSingle()
  return !!data
}

// Devuelve una signed URL de 1h para el PDF ya firmado en vez de la URL pública horneada —
// funciona igual si el bucket `contratos` sigue público hoy, y sigue funcionando el día que se
// haga privado (ver PROMPT_ARQUITECTURA_PENDIENTE.md punto 4), sin tener que tocar esta ruta.
async function freshPdfUrl(
  sb: SupabaseClient,
  contractId: string,
  hasSignedPdf: boolean,
  ttlSeconds = 60 * 60
): Promise<string | null> {
  if (!hasSignedPdf) return null
  const signed = await sb.storage.from(BUCKET).createSignedUrl(`${contractId}.pdf`, ttlSeconds)
  return signed.data?.signedUrl ?? null
}

// Sube el PDF firmado a Storage y devuelve su RUTA (no una URL).
// Un contrato firmado lleva nombre, DNI y firma: el bucket es privado y se sirve con signed URLs
// de vida corta. Antes esta función creaba el bucket como público y devolvía una URL permanente,
// lo que dejaba el PDF descargable por cualquiera que tuviera el enlace, para siempre.
async function uploadSignedPdf(sb: SupabaseClient, contractId: string, bytes: Uint8Array): Promise<string> {
  const path = `${contractId}.pdf`
  const body = Buffer.from(bytes)
  const up = await sb.storage.from(BUCKET).upload(path, body, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw new Error(`No se pudo guardar el PDF: ${up.error.message}`)
  return path
}

// GET — datos del contrato para la página pública de firma (por token).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const sb = service()
  const { data } = await sb
    .from('contracts')
    .select(
      'id, tenant_id, title, body_snapshot, terms, status, signer_name, signer_data, signed_at, signed_pdf_url, user_id'
    )
    .eq('signing_token', token)
    .maybeSingle()
  if (!data || !(await requireActiveTenant(sb, data.tenant_id))) {
    return NextResponse.json({ error: 'Contrato no encontrado' }, { status: 404 })
  }
  const tenantId = data.tenant_id

  const company = await getCompanyProfile(sb, tenantId)

  // Prefill de datos del firmante con lo que ya sepamos del miembro.
  let memberName: string | null = null
  const prefill: SignerData = (data.signer_data as SignerData) ?? {}
  if (data.user_id) {
    const { data: u } = await sb
      .from('users')
      .select('full_name, phone, dni, address')
      .eq('id', data.user_id)
      .maybeSingle()
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
    signedPdfUrl: await freshPdfUrl(sb, data.id, !!data.signed_pdf_url),
  })
}

// POST — el colaborador firma: valida consentimiento, genera el PDF (con la
// firma fija de la empresa), lo guarda en Blob y marca el contrato como firmado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
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
    const { data: c } = await sb
      .from('contracts')
      .select('id, tenant_id, title, body_snapshot, terms, status, created_by, user_id')
      .eq('signing_token', token)
      .maybeSingle()
    if (!c || !(await requireActiveTenant(sb, c.tenant_id))) {
      return NextResponse.json({ error: 'Contrato no encontrado' }, { status: 404 })
    }
    if (c.status === 'firmado') {
      return NextResponse.json({ error: 'Este contrato ya está firmado' }, { status: 409 })
    }
    const tenantId = c.tenant_id

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
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
      const { data: mu } = await sb
        .from('users')
        .select('full_name, email, personal_email')
        .eq('id', c.user_id)
        .maybeSingle()
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
        // Signed URL de 7 días (no la url pública horneada — el bucket `contratos` es privado):
        // el correo puede abrirse días después de firmar, a diferencia de la respuesta de esta
        // misma request, que solo necesita 1h (freshPdfUrl() de más abajo).
        pdfUrl: await freshPdfUrl(sb, c.id, true, 60 * 60 * 24 * 7),
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

    return NextResponse.json({ ok: true, signedPdfUrl: await freshPdfUrl(sb, c.id, true) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
