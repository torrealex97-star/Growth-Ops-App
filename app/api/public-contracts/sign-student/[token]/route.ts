import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { buildStudentContractPdf } from '@/lib/contracts/pdf-student'
import { getCompanyProfile } from '@/lib/contracts/company'
import { applyVars, stripRemainingVars } from '@/lib/contracts/terms'
import {
  studentSignerVars,
  studentConditionLines,
  STUDENT_SIGNER_FIELDS,
  validateStudentSigner,
  DEFAULT_STUDENT_WELCOME,
  type StudentContractTerms,
  type StudentSignerData,
} from '@/lib/contracts/student'
import { sendStudentSignedEmail, sendStudentOnboardingEmail } from '@/lib/email/resend'
import { fireOnboardingWebhook, toCountryISO } from '@/lib/ghl'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'

const BUCKET = 'contratos'

function service() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Ruta PÚBLICA (la abre el alumno/tomador sin sesión, solo con el token de firma) y NO anidada
// bajo /api/[tenant]/... porque la página /firmar-alumno/[token] no conoce el tenant (solo el
// token). El tenant se resuelve leyendo el contrato por `signing_token`, que tiene índice UNIQUE
// global (20260910110000_restore_original_features.sql) — el token en sí (aleatorio, único) es
// el mecanismo de seguridad principal, no la subcuenta.
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

// Devuelve la RUTA, no una URL: el contrato firmado de un alumno lleva datos personales y firma,
// así que el bucket es privado y la descarga va siempre por signed URL de vida corta (freshPdfUrl).
async function uploadSignedPdf(sb: SupabaseClient, contractId: string, bytes: Uint8Array): Promise<string> {
  const path = `${contractId}.pdf`
  const body = Buffer.from(bytes)
  const up = await sb.storage.from(BUCKET).upload(path, body, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw new Error(`No se pudo guardar el PDF: ${up.error.message}`)
  return path
}

// GET — datos del contrato de alumno para la página pública de firma.
// Además marca la primera apertura (read_at) para el tracking del closer.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const sb = service()
  const { data } = await sb
    .from('contracts')
    .select(
      'id, tenant_id, title, body_snapshot, terms, status, signer_name, signer_data, signed_at, signed_pdf_url, contact_id, template_id, read_at'
    )
    .eq('signing_token', token)
    .eq('kind', 'venta')
    .maybeSingle()
  if (!data || !(await requireActiveTenant(sb, data.tenant_id))) {
    return NextResponse.json({ error: 'Contrato no encontrado' }, { status: 404 })
  }
  const tenantId = data.tenant_id

  const company = await getCompanyProfile(sb, tenantId)

  // Prefill con lo que sepamos del contacto.
  let studentName: string | null = null
  let studentEmail: string | null = null
  const prefill: StudentSignerData = (data.signer_data as StudentSignerData) ?? {}
  if (data.contact_id) {
    const { data: c } = await sb
      .from('contacts')
      .select('full_name, email, phone')
      .eq('id', data.contact_id)
      .maybeSingle()
    studentName = c?.full_name ?? null
    studentEmail = c?.email ?? null
    if (c) prefill.phone = prefill.phone ?? c.phone ?? null
  }

  // Mensaje de bienvenida de la plantilla.
  let welcome = DEFAULT_STUDENT_WELCOME
  if (data.template_id) {
    const { data: tpl } = await sb
      .from('contract_templates')
      .select('welcome_message')
      .eq('id', data.template_id)
      .maybeSingle()
    if (tpl?.welcome_message) welcome = tpl.welcome_message
  }

  // Marca "leído" (primera apertura) si aún no está firmado.
  if (data.status !== 'firmado' && !data.read_at) {
    await sb.from('contracts').update({ read_at: new Date().toISOString() }).eq('id', data.id)
  }

  const terms = (data.terms ?? {}) as StudentContractTerms
  return NextResponse.json({
    id: data.id,
    title: data.title,
    body: data.body_snapshot,
    welcome,
    conditions: studentConditionLines(terms),
    status: data.status,
    studentName,
    studentEmail,
    company: {
      name: company.name,
      cif: company.cif,
      address: [company.address, company.postal_code, company.city].filter(Boolean).join(', ') || null,
    },
    signerFields: STUDENT_SIGNER_FIELDS,
    signerPrefill: prefill,
    signerName: data.signer_name,
    signedAt: data.signed_at,
    signedPdfUrl: await freshPdfUrl(sb, data.id, !!data.signed_pdf_url),
  })
}

// POST — el alumno acepta las condiciones: genera PDF, marca firmado, envía copia
// y dispara el webhook de onboarding a GoHighLevel para darle los accesos.
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const { signerName, consent, signerData } = (await req.json()) as {
      signerName?: string
      consent?: boolean
      signerData?: StudentSignerData
    }
    if (!signerName?.trim() || !consent) {
      return NextResponse.json({ error: 'Falta el nombre completo o la aceptación de condiciones' }, { status: 400 })
    }
    const sd: StudentSignerData = signerData ?? {}
    const validationErrors = validateStudentSigner(sd)
    if (validationErrors.length) {
      return NextResponse.json({ error: validationErrors.join(' ') }, { status: 400 })
    }

    const sb = service()
    const { data: c } = await sb
      .from('contracts')
      .select(
        'id, tenant_id, title, body_snapshot, terms, status, created_by, contact_id, sale_id, is_reservation, contract_party'
      )
      .eq('signing_token', token)
      .eq('kind', 'venta')
      .maybeSingle()
    if (!c || !(await requireActiveTenant(sb, c.tenant_id))) {
      return NextResponse.json({ error: 'Contrato no encontrado' }, { status: 404 })
    }
    if (c.status === 'firmado') return NextResponse.json({ error: 'Este contrato ya está firmado' }, { status: 409 })
    const tenantId = c.tenant_id

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
    const ua = req.headers.get('user-agent')
    const signedAt = new Date().toISOString()
    const terms = (c.terms ?? {}) as StudentContractTerms

    // Datos del contacto (nombre/email/teléfono/ghl id) para el PDF y el webhook.
    let studentEmail: string | null = null
    let studentPhone: string | null = null
    let ghlContactId: string | null = null
    let contactFirstName: string | null = null
    let contactLastName: string | null = null
    let contactCountry: string | null = null
    let contactInstagram: string | null = null
    if (c.contact_id) {
      const { data: contact } = await sb
        .from('contacts')
        .select('email, phone, ghl_contact_id, first_name, last_name, country, instagram')
        .eq('id', c.contact_id)
        .maybeSingle()
      studentEmail = contact?.email ?? null
      studentPhone = contact?.phone ?? sd.phone ?? null
      ghlContactId = contact?.ghl_contact_id ?? null
      contactFirstName = contact?.first_name ?? null
      contactLastName = contact?.last_name ?? null
      contactCountry = contact?.country ?? null
      contactInstagram = contact?.instagram ?? null
    }
    // Partimos el nombre del firmante como fallback si el contacto no traía first/last.
    const nameParts = signerName.trim().split(/\s+/)
    const firstName = contactFirstName ?? (nameParts[0] || null)
    const lastName = contactLastName ?? (nameParts.length > 1 ? nameParts.slice(1).join(' ') : null)

    // El contrato de RESERVA y el del TOMADOR NO dan accesos: solo el contrato del
    // ALUMNO (venta completa) dispara el webhook de onboarding y el correo de accesos.
    const firesAccesos = (c.contract_party ?? 'alumno') === 'alumno' && !c.is_reservation
    // Los accesos se envían al email decidido en la venta (sales.access_email); si no,
    // al email del contacto/alumno. Útil cuando compra un tomador y decide a quién van.
    let accessEmail: string | null = studentEmail
    if (c.sale_id) {
      const { data: saleRow } = await sb.from('sales').select('access_email').eq('id', c.sale_id).maybeSingle()
      if (saleRow?.access_email?.trim()) accessEmail = saleRow.access_email.trim()
    }

    let createdByName: string | null = null
    if (c.created_by) {
      const { data: u } = await sb.from('users').select('full_name').eq('id', c.created_by).maybeSingle()
      createdByName = u?.full_name ?? null
    }

    const company = await getCompanyProfile(sb, tenantId)
    const finalBody = stripRemainingVars(applyVars(c.body_snapshot ?? '', studentSignerVars(sd)))
    const hash = createHash('sha256')
      .update(JSON.stringify({ id: c.id, body: finalBody, terms, sd, signerName, signedAt }))
      .digest('hex')

    const pdfBytes = await buildStudentContractPdf({
      title: c.title ?? 'Contrato de formación',
      bodyText: finalBody,
      terms,
      company,
      signerName: signerName.trim(),
      signerData: sd,
      signerEmail: studentEmail,
      signedAtISO: signedAt,
      signerIp: ip,
      createdByName,
      contractId: c.id,
      hash,
    })

    const url = await uploadSignedPdf(sb, c.id, pdfBytes)

    // Persiste teléfono en el contacto si lo aportó al firmar.
    if (c.contact_id && sd.phone) {
      await sb
        .from('contacts')
        .update({ phone: sd.phone })
        .eq('id', c.contact_id)
        .then(
          () => {},
          () => {}
        )
    }

    // Dispara el webhook de onboarding a GHL SOLO en el contrato de alumno (venta
    // completa). En reserva / tomador queda inerte (no se dan accesos aquí).
    const webhook = firesAccesos
      ? await fireOnboardingWebhook(await getTenantConfigWithFallback(tenantId), {
          contractId: c.id,
          saleId: c.sale_id,
          contactId: c.contact_id,
          name: signerName.trim(),
          first_name: firstName,
          last_name: lastName,
          email: accessEmail,
          phone: studentPhone,
          dni: sd.dni ?? null,
          address: sd.address ?? null,
          city: sd.city ?? null,
          country: toCountryISO(contactCountry),
          instagram: contactInstagram,
          product: terms.product_name || 'Programa',
          duration_months: terms.duration_months ?? null,
          amount: terms.gross_amount ?? null,
          currency: terms.currency ?? null,
          payment_method: terms.payment_method ?? null,
          plan_name: terms.plan_name ?? null,
          ghl_contact_id: ghlContactId,
        })
      : { ok: false, skipped: true as const }

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
        // Solo marcamos accesos_enviados si el webhook se disparó de verdad (no si está sin configurar).
        accesos_enviados_at: webhook.ok ? signedAt : null,
        onboarding_webhook_ok: webhook.skipped ? null : webhook.ok,
      })
      .eq('id', c.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Copia del contrato firmado al firmante (alumno o tomador).
    if (studentEmail) {
      // Signed URL de 7 días (no la url pública horneada — el bucket `contratos` es privado): el
      // correo puede abrirse días después de firmar, a diferencia de la respuesta de esta misma
      // request, que solo necesita 1h (freshPdfUrl() más abajo).
      await sendStudentSignedEmail({
        to: studentEmail,
        studentName: signerName.trim(),
        company,
        pdfUrl: await freshPdfUrl(sb, c.id, true, 60 * 60 * 24 * 7),
        pdfBytes,
      })
    }
    // Al confirmarse el envío de accesos → correo de onboarding con el paso a paso
    // y el enlace a la landing donde el alumno encuentra sus accesos.
    if (webhook.ok && accessEmail) {
      await sendStudentOnboardingEmail({ to: accessEmail, studentName: signerName.trim(), company })
    }

    await sb.from('audit_logs').insert({
      tenant_id: tenantId,
      entity_type: 'contract',
      entity_id: c.id,
      action: 'update',
      new_values: {
        status: 'firmado',
        signer_name: signerName.trim(),
        hash,
        ip,
        party: c.contract_party,
        is_reservation: c.is_reservation,
        onboarding_webhook: webhook,
      },
    })

    return NextResponse.json({
      ok: true,
      signedPdfUrl: await freshPdfUrl(sb, c.id, true),
      accesosEnviados: webhook.ok,
      webhookSkipped: !!webhook.skipped,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
