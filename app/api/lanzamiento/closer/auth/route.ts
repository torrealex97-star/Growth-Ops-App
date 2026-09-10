import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getCloserByEmail } from '@/lib/db-lanzamiento'
import { signCloserSession, CLOSER_COOKIE } from '@/lib/lanzamiento-session'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: 'Email y contraseña requeridos' }, { status: 400 })
  }

  const closer = await getCloserByEmail(email)
  if (!closer || !closer.activa) {
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 })
  }

  const valid = await bcrypt.compare(password, closer.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 })
  }

  const token = signCloserSession(closer.id)
  const res = NextResponse.json({ ok: true, nombre: closer.nombre, id: closer.id })
  res.cookies.set(CLOSER_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(CLOSER_COOKIE)
  return res
}
