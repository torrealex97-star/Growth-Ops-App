import { NextRequest, NextResponse } from 'next/server'
import { getAllClosers } from '@/lib/db-lanzamiento'
import { getCallers } from '@/lib/db-coldcalling'

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

// Returns BOTH launch_closers AND cold_callers, so the admin "Nueva Venta" form
// can populate the three independent selects (closer / setter / coldcaller)
// from a single call.
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  const [closers, coldcallers] = await Promise.all([
    getAllClosers(),
    getCallers(),
  ])

  return NextResponse.json({
    closers: closers.map(c => ({ id: c.id, nombre: c.nombre, activa: c.activa })),
    coldcallers: coldcallers.map(c => ({ id: c.id, nombre: c.nombre, activa: c.activa })),
  })
}
