import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getCallerByEmail } from '@/lib/db-coldcalling'
import { signSession, SESSION_COOKIE } from '@/lib/cc-session'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: 'Email y contraseña requeridos' }, { status: 400 })
  }

  const caller = await getCallerByEmail(email)
  if (!caller || !caller.activa) {
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 })
  }

  const valid = await bcrypt.compare(password, caller.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Credenciales incorrectas' }, { status: 401 })
  }

  const token = signSession(caller.id)
  const res = NextResponse.json({ ok: true, nombre: caller.nombre, id: caller.id })
  res.cookies.set(SESSION_COOKIE, token, {
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
  res.cookies.delete(SESSION_COOKIE)
  return res
}
