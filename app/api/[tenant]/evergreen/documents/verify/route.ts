import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

// Construido dentro del handler: a nivel de módulo rompía el build entero si las env vars de
// Supabase no estaban disponibles en ese momento (p.ej. Vercel Preview sin esas env vars).
function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!t.isSuperAdmin && !['admin', 'director', 'closer'].includes(t.role ?? '')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (Number.isFinite(contentLength) && contentLength > 15 * 1024 * 1024) {
    return NextResponse.json({ error: 'Document is too large' }, { status: 413 })
  }

  try {
    const rawBody = await req.text()
    if (Buffer.byteLength(rawBody, 'utf8') > 15 * 1024 * 1024) {
      return NextResponse.json({ error: 'Document is too large' }, { status: 413 })
    }
    const data: unknown = JSON.parse(rawBody)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { saleId, contactId, countryCode, documentType, fileBase64, fileName } = data as Record<string, unknown>

    if (
      typeof saleId !== 'string' ||
      typeof contactId !== 'string' ||
      typeof countryCode !== 'string' ||
      typeof documentType !== 'string' ||
      typeof fileBase64 !== 'string' ||
      typeof fileName !== 'string' ||
      !saleId.trim() ||
      !contactId.trim() ||
      !countryCode.trim() ||
      !documentType.trim() ||
      !fileBase64 ||
      !fileName.trim()
    ) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (!['dni', 'pasaporte', 'nie', 'otro'].includes(documentType)) {
      return NextResponse.json({ error: 'Invalid document type' }, { status: 400 })
    }

    // La venta es la fuente canónica de contacto. Nunca usar el ID del cliente para
    // elegir la ruta de Storage ni para relacionar el registro de verificación.
    const supabase = serviceClient()
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .select('id, contact_id')
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()

    if (saleError) return NextResponse.json({ error: 'Could not verify sale' }, { status: 500 })
    if (!sale?.contact_id) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    if (contactId !== sale.contact_id) {
      return NextResponse.json({ error: 'Contact does not match sale' }, { status: 400 })
    }
    if (!/^[A-Z]{2}$/.test(countryCode.toUpperCase())) {
      return NextResponse.json({ error: 'Invalid country code' }, { status: 400 })
    }

    // También comprobar la dimensión tenant del contacto por si hay una relación antigua
    // incoherente en datos creados antes del aislamiento multitenant.
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', sale.contact_id)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (contactError) return NextResponse.json({ error: 'Could not verify contact' }, { status: 500 })
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

    const safeFileName = fileName
      .split(/[\\/]/)
      .pop()
      ?.replace(/^\.+/, '')
      .replace(/[^\w.-]/g, '_')
      .slice(0, 120)
    if (!safeFileName) return NextResponse.json({ error: 'Invalid file name' }, { status: 400 })

    // Rechazar base64 malformado o mayor de 10 MiB antes de reservar memoria/subir.
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(fileBase64)) {
      return NextResponse.json({ error: 'Invalid document encoding' }, { status: 400 })
    }
    if (Buffer.byteLength(fileBase64, 'base64') > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Document is too large' }, { status: 413 })
    }
    const buffer = Buffer.from(fileBase64, 'base64')
    if (buffer.length === 0) return NextResponse.json({ error: 'Empty document' }, { status: 400 })

    const storagePath = `documentos-verificacion/${saleId}/${sale.contact_id}/${Date.now()}-${safeFileName}`
    const { error: uploadError } = await supabase.storage.from('documentos-verificacion').upload(storagePath, buffer, {
      cacheControl: '3600',
      upsert: false,
    })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 })
    }

    // Signed URL de 30 días (antes 10 años, prácticamente permanente sobre un documento de identidad).
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('documentos-verificacion')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30)
    if (signedUrlError || !signedUrlData?.signedUrl) {
      const { error: cleanupError } = await supabase.storage.from('documentos-verificacion').remove([storagePath])
      if (cleanupError) console.error('Storage cleanup failed after signed URL error:', cleanupError.message)
      return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 })
    }

    const { data: docVerif, error: dbError } = await supabase
      .from('document_verifications')
      .insert({
        tenant_id: t.tenantId,
        sale_id: saleId,
        contact_id: sale.contact_id,
        country_code: countryCode.toUpperCase(),
        document_type: documentType,
        document_url: signedUrlData.signedUrl,
        status: 'pending',
      })
      .select('id')
      .single()

    if (dbError || !docVerif) {
      console.error('Database insert error:', dbError?.message ?? 'No verification row returned')
      const { error: cleanupError } = await supabase.storage.from('documentos-verificacion').remove([storagePath])
      if (cleanupError) console.error('Storage cleanup failed after database error:', cleanupError.message)
      return NextResponse.json({ error: 'Failed to create verification record' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      document_id: docVerif.id,
      message: 'Document uploaded successfully. Awaiting verification.',
    })
  } catch (error) {
    console.error('Document verification error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
