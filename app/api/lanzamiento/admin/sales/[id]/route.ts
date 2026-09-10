import { NextRequest, NextResponse } from 'next/server'
import { updateSale, deleteSale, getSales } from '@/lib/db-lanzamiento'
import { updateSaleSheetRow, deleteSaleSheetRow } from '@/lib/sheets-write'

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

const ALLOWED_FIELDS = [
  'coldcaller_id', 'setter_id', 'afiliado_email', 'plataforma', 'tipo_pago',
  'cash_collected', 'valor', 'closer_id', 'fecha', 'nombre', 'apellido',
  'telefono', 'email', 'status', 'nota',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
] as const

type AllowedField = (typeof ALLOWED_FIELDS)[number]

const NUMERIC_NULLABLE_INT = new Set<AllowedField>(['coldcaller_id', 'setter_id', 'closer_id'])
const NUMERIC = new Set<AllowedField>(['cash_collected', 'valor'])

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const body = await req.json()
  const fields: Record<string, unknown> = {}

  for (const key of ALLOWED_FIELDS) {
    if (!(key in body)) continue
    const raw = (body as Record<string, unknown>)[key]
    if (NUMERIC_NULLABLE_INT.has(key)) {
      fields[key] = raw === null || raw === '' || raw === undefined ? null : Number(raw)
    } else if (NUMERIC.has(key)) {
      fields[key] = raw === null || raw === '' || raw === undefined ? null : Number(raw)
    } else {
      fields[key] = raw === '' ? null : raw
    }
  }

  const updated = await updateSale(id, fields)

  // Sync changes to Google Sheet if we know the row
  if (updated.sheet_row) {
    const sheetPatch: Record<string, string | number | null> = {}
    if ('cash_collected' in fields) sheetPatch.cash_collected = fields.cash_collected as number
    if ('valor'          in fields) sheetPatch.valor          = fields.valor as number
    if ('plataforma'     in fields) sheetPatch.plataforma     = fields.plataforma as string | null
    if ('tipo_pago'      in fields) sheetPatch.tipo_pago      = fields.tipo_pago as string
    if ('afiliado_email' in fields) sheetPatch.afiliado_email = fields.afiliado_email as string | null

    if (Object.keys(sheetPatch).length > 0) {
      try {
        const sales = await getSales()
        const sale = sales.find(s => s.id === id)
        if (sale) {
          await updateSaleSheetRow(updated.sheet_row, {
            ...sheetPatch,
            ...(sale.coldcaller_nombre ? { setter_nombre: sale.coldcaller_nombre } : {}),
          })
        }
      } catch (err) {
        console.error('Sheet update error (non-fatal):', err)
      }
    }
  }

  return NextResponse.json({ ok: true, sale: updated })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

  const { sheet_row } = await deleteSale(id)

  if (sheet_row) {
    try {
      await deleteSaleSheetRow(sheet_row)
    } catch (err) {
      console.error('Sheet delete error (non-fatal):', err)
    }
  }

  return NextResponse.json({ ok: true })
}
