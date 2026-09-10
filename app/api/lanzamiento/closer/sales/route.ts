import { NextRequest, NextResponse } from 'next/server'
import { getCloserIdFromCookies } from '@/lib/lanzamiento-session'
import { getCloserById, registerSale, updateSaleSheetRow } from '@/lib/db-lanzamiento'
import { appendSaleRow } from '@/lib/sheets-write'

const VALID_PLATAFORMAS = ['Stripe', 'Sequra', 'Transferencia']
const VALID_TIPOS_PAGO = ['Reserva', 'FullPay', '2Pagos', '3Pagos', '4Pagos', 'Sequra6pagos', 'Sequra12pagos']

export async function POST(req: NextRequest) {
  const closerId = getCloserIdFromCookies()
  if (!closerId) return NextResponse.json({ error: 'No autenticada' }, { status: 401 })

  const closer = await getCloserById(closerId)
  if (!closer) return NextResponse.json({ error: 'Closer no encontrada' }, { status: 401 })

  const body = await req.json()
  const {
    fecha, nombre, apellido, telefono, email,
    plataforma, valor, tipo_pago, cash_collected,
    coldcaller_id, coldcaller_nombre, lead_email,
    afiliado_email, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  } = body

  if (!fecha || !nombre || !email || !plataforma || !tipo_pago) {
    return NextResponse.json({ error: 'Faltan campos obligatorios' }, { status: 400 })
  }
  if (!VALID_PLATAFORMAS.includes(plataforma)) {
    return NextResponse.json({ error: 'Plataforma inválida' }, { status: 400 })
  }
  if (!VALID_TIPOS_PAGO.includes(tipo_pago)) {
    return NextResponse.json({ error: 'Tipo de pago inválido' }, { status: 400 })
  }

  const sale = await registerSale({
    fecha,
    nombre: nombre || '',
    apellido: apellido || '',
    telefono: telefono || '',
    email: email || '',
    plataforma,
    valor: valor != null && valor !== '' ? Number(valor) : null,
    tipo_pago,
    cash_collected: cash_collected != null && cash_collected !== '' ? Number(cash_collected) : null,
    closer_id: closerId,
    coldcaller_id: coldcaller_id ? Number(coldcaller_id) : null,
    lead_email: lead_email || null,
    afiliado_email: afiliado_email || null,
    utm_source: utm_source || null,
    utm_medium: utm_medium || null,
    utm_campaign: utm_campaign || null,
    utm_content: utm_content || null,
    utm_term: utm_term || null,
  })

  // Sync to Google Sheet (non-blocking on error)
  try {
    const sheetRow = await appendSaleRow({
      id: sale.id,
      fecha,
      nombre: nombre || '',
      apellido: apellido || '',
      telefono: telefono || '',
      email: email || '',
      plataforma,
      valor: valor ? Number(valor) : null,
      tipo_pago,
      cash_collected: cash_collected ? Number(cash_collected) : null,
      closer_nombre: closer.nombre,
      setter_nombre: coldcaller_nombre || '',
    })
    if (sheetRow) await updateSaleSheetRow(sale.id, sheetRow)
  } catch (err) {
    console.error('Sheet append error (non-fatal):', err)
  }

  return NextResponse.json({ ok: true, sale })
}
