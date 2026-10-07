import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { importContractTemplateFile } from '@/lib/contracts/import-template'

export const runtime = 'nodejs'
export const maxDuration = 20

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const access = await requireTenant(tenant)
    if ('error' in access) return access.error
    if (!['admin', 'director'].includes(access.role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })
    }

    const imported = await importContractTemplateFile(file)
    return NextResponse.json({ ok: true, ...imported })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo importar el contrato'
    const expected = /vacío|límite|Formato|PDF válido|texto seleccionable|no contiene texto|supera/.test(message)
    return NextResponse.json({ error: message }, { status: expected ? 400 : 500 })
  }
}
