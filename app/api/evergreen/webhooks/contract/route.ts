import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Webhook de firma de contrato: lo llama la herramienta de firma (e-sign / GHL / Zapier)
// cuando el contrato se firma. Marca el contrato como 'firmado', guarda la URL del PDF
// firmado y la fecha. Auth: cabecera x-ghl-secret (reutiliza GHL_WEBHOOK_SECRET).
// Identifica el contrato por: contractId → saleId → email del alumno (último pendiente).
export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-ghl-secret')
    // Fail-closed: si el secret no está configurado o no coincide, rechazamos.
    if (!process.env.GHL_WEBHOOK_SECRET || secret !== process.env.GHL_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await req.json()
    const cd = payload.customData || payload.custom_data || {}
    const p = { ...payload, ...cd }
    const contractId = p.contractId || p.contract_id || null
    const saleId = p.saleId || p.sale_id || null
    const email = (p.email as string | null)?.toLowerCase?.().trim() || null
    const signedUrl = p.signedUrl || p.signed_url || p.url || null
    // IP del firmante: la manda la herramienta de firma en el payload, o si no la
    // cabecera de la petición. Sirve de evidencia legal como en el flujo nativo.
    const signerIp =
      (p.ip as string | null) || (p.signer_ip as string | null) ||
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') || null
    const now = new Date().toISOString()

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // Resolver el contrato objetivo
    let targetId: string | null = contractId
    if (!targetId && saleId) {
      const { data } = await sb.from('contracts').select('id').eq('sale_id', saleId).order('created_at', { ascending: false }).limit(1).maybeSingle()
      targetId = data?.id ?? null
    }
    if (!targetId && email) {
      const { data: contact } = await sb.from('contacts').select('id').eq('email', email).maybeSingle()
      if (contact) {
        const { data } = await sb.from('contracts').select('id').eq('contact_id', contact.id).neq('status', 'firmado').order('created_at', { ascending: false }).limit(1).maybeSingle()
        targetId = data?.id ?? null
      }
    }
    if (!targetId) return NextResponse.json({ error: 'No se encontró el contrato (envía contractId, saleId o email)' }, { status: 404 })

    const { error } = await sb.from('contracts')
      .update({ status: 'firmado', signed_at: now, ...(signedUrl ? { url: signedUrl } : {}), ...(signerIp ? { signer_ip: signerIp } : {}) })
      .eq('id', targetId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, contractId: targetId, status: 'firmado' })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
