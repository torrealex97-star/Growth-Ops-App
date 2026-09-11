import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const BUCKET = 'pagos'
const SIGNED_URL_TTL_SECONDS = 60 * 60 // 1h — se pide fresca en cada visualización, no se guarda.

// Devuelve una signed URL corta para ver el justificante de pago de una venta, generada en el
// momento (nunca guardada). Sustituye a leer sales.payment_proof_url directamente, que era una
// signed URL de 10 años horneada en la base de datos — ver sales/payment-proof/route.ts.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error

  const saleId = req.nextUrl.searchParams.get('saleId')
  if (!saleId) return NextResponse.json({ error: 'Falta saleId' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: sale, error } = await sb
    .from('sales')
    .select('payment_proof_path, payment_proof_url')
    .eq('id', saleId)
    .eq('tenant_id', t.tenantId)
    .maybeSingle()
  if (error || !sale) return NextResponse.json({ error: 'Venta no encontrada' }, { status: 404 })

  if (sale.payment_proof_path) {
    const signed = await sb.storage.from(BUCKET).createSignedUrl(sale.payment_proof_path, SIGNED_URL_TTL_SECONDS)
    if (signed.error || !signed.data?.signedUrl) {
      return NextResponse.json({ error: 'No se pudo generar el enlace' }, { status: 500 })
    }
    return NextResponse.json({ url: signed.data.signedUrl })
  }

  // Ventas anteriores a este cambio: no tienen path guardado, solo la URL larga original.
  // Se sigue sirviendo tal cual — no hay forma de recuperar el path desde una URL ya firmada.
  if (sale.payment_proof_url) return NextResponse.json({ url: sale.payment_proof_url })

  return NextResponse.json({ error: 'Esta venta no tiene justificante de pago' }, { status: 404 })
}
