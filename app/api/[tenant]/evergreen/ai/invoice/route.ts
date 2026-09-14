import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { tenantActiveUserNames } from '@/lib/users'
import { extractInvoice, type InvoiceExtract } from '@/lib/ai/claude'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 60

// Convierte un importe a EUR usando tipos de cambio del BCE (vía frankfurter.dev, sin clave).
// Si la moneda ya es EUR o la conversión falla, devuelve null y el importe se deja tal cual.
async function convertToEur(
  amount: number,
  currency: string,
  date: string | null
): Promise<{ amountEur: number; rate: number } | null> {
  const code = currency.trim().toUpperCase()
  if (code === 'EUR') return null
  try {
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : 'latest'
    const res = await fetch(`https://api.frankfurter.dev/v1/${day}?base=${code}&symbols=EUR`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const rate = data?.rates?.EUR
    if (typeof rate !== 'number' || !isFinite(rate)) return null
    return { amountEur: Math.round(amount * rate * 100) / 100, rate }
  } catch {
    return null
  }
}

// Recibe una factura (base64 + mediaType) y devuelve los datos extraídos.
// NO crea el gasto: la UI lo muestra como borrador para revisar y confirmar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { fileBase64, mediaType } = await req.json()
    if (!fileBase64 || !mediaType) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role
    if (!['admin', 'director', 'manager'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    // Solo el equipo de ESTA subcuenta: antes se mandaban al modelo los nombres de todos los
    // usuarios activos de la plataforma, los de otras subcuentas incluidos.
    const teamNames = await tenantActiveUserNames(sb, t.tenantId)

    const base64 = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64
    const extracted = await extractInvoice(base64, mediaType, teamNames)

    // El resto de la app (importes, totales, informes) asume EUR. Si la factura viene en otra
    // moneda, convertimos aquí para que "amount" siempre sea EUR, y guardamos el original para
    // que quede constancia de la conversión aplicada.
    let result: InvoiceExtract & { original_amount?: number; original_currency?: string; fx_rate?: number } = extracted
    if (typeof extracted.amount === 'number' && extracted.currency && extracted.currency.toUpperCase() !== 'EUR') {
      const converted = await convertToEur(extracted.amount, extracted.currency, extracted.expense_date)
      if (converted) {
        result = {
          ...extracted,
          original_amount: extracted.amount,
          original_currency: extracted.currency.toUpperCase(),
          fx_rate: converted.rate,
          amount: converted.amountEur,
          currency: 'EUR',
        }
      }
    }

    return NextResponse.json({ ok: true, extracted: result })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
