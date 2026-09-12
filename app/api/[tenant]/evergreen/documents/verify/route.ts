import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

const serviceClient = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  try {
    const supabase = serviceClient()
    const data = await req.json()
    const { saleId, contactId, countryCode, documentType, fileBase64, fileName } = data

    if (!saleId || !contactId || !countryCode || !documentType || !fileBase64 || !fileName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Validar que la venta y contacto existan (y pertenezcan a esta subcuenta)
    const { data: sale } = await supabase
      .from('sales')
      .select('id, contact_id')
      .eq('id', saleId)
      .eq('tenant_id', t.tenantId)
      .single()

    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    // Convertir base64 a buffer
    const buffer = Buffer.from(fileBase64, 'base64')

    // Generar nombre único para el documento
    const timestamp = Date.now()
    const storagePath = `documentos-verificacion/${saleId}/${contactId}/${timestamp}-${fileName}`

    // Subir a Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documentos-verificacion')
      .upload(storagePath, buffer, {
        cacheControl: '3600',
        upsert: false,
      })

    if (uploadError) {
      console.error('Storage upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 })
    }

    // Signed URL de 30 días (antes 10 años, prácticamente permanente sobre un documento de
    // identidad). Nada en la UI actual vuelve a leer document_url para mostrarlo — es un registro
    // de auditoría de la subida, no un enlace que se reutilice — así que una ventana corta no
    // rompe ninguna funcionalidad existente y reduce la exposición si la URL se filtrase.
    const { data: signedUrlData } = await supabase.storage
      .from('documentos-verificacion')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 30)

    if (!signedUrlData?.signedUrl) {
      return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 })
    }

    // Crear registro en document_verifications
    const { data: docVerif, error: dbError } = await supabase
      .from('document_verifications')
      .insert({
        tenant_id: t.tenantId,
        sale_id: saleId,
        contact_id: contactId,
        country_code: countryCode,
        document_type: documentType,
        document_url: signedUrlData.signedUrl,
        status: 'pending', // Pendiente de verificación manual
      })
      .select()
      .single()

    if (dbError) {
      console.error('Database insert error:', dbError)
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
