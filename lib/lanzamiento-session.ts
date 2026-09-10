import crypto from 'crypto'
import { cookies } from 'next/headers'

const COOKIE = 'tcc-launch-closer'

function getSecret() {
  return process.env.CC_SESSION_SECRET || 'cc-secret-fallback-2026'
}

export function signCloserSession(closerId: number): string {
  const payload = `c${closerId}`
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

export function verifyCloserSession(token: string): number | null {
  const dot = token.lastIndexOf('.')
  if (dot === -1) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  if (sig !== expected) return null
  const id = parseInt(payload.slice(1))
  return isNaN(id) ? null : id
}

export function getCloserIdFromCookies(): number | null {
  const cookieStore = cookies()
  const token = cookieStore.get(COOKIE)?.value
  if (!token) return null
  return verifyCloserSession(token)
}

export const CLOSER_COOKIE = COOKIE
