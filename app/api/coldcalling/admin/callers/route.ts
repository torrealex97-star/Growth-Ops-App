import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getCallers, createCaller, updateCaller, deleteCaller } from '@/lib/db-coldcalling'

function isAdmin(req: NextRequest) {
  return req.cookies.get('tcc-auth')?.value === 'true'
}

// GET all callers
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const callers = await getCallers()
  return NextResponse.json(callers)
}

// POST create caller
export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { email, nombre, password, peso = 100 } = await req.json()
  if (!email || !nombre || !password) {
    return NextResponse.json({ error: 'email, nombre y password requeridos' }, { status: 400 })
  }
  const hash = await bcrypt.hash(password, 10)
  const caller = await createCaller(email, nombre, hash, peso)
  return NextResponse.json(caller, { status: 201 })
}

// PATCH update caller
export async function PATCH(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id, activa, peso, nombre } = await req.json()
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  await updateCaller(Number(id), { activa, peso, nombre })
  return NextResponse.json({ ok: true })
}

// DELETE caller
export async function DELETE(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  await deleteCaller(Number(id))
  return NextResponse.json({ ok: true })
}
