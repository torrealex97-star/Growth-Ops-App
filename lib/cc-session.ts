import crypto from 'crypto'
import { cookies } from 'next/headers'

const COOKIE = 'tcc-cc-session'

function getSecret() {
  return process.env.CC_SESSION_SECRET || 'cc-secret-fallback-2026'
}

/** Signs a session token using Node crypto (runs in API routes / server components, not Edge) */
export function signSession(callerId: number): string {
  const payload = String(callerId)
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  return `${payload}.${sig}`
}

/** Verifies a session token using Node crypto */
export function verifySession(token: string): number | null {
  const dot = token.lastIndexOf('.')
  if (dot === -1) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex')
  if (sig !== expected) return null
  const id = parseInt(payload)
  return isNaN(id) ? null : id
}

export function getCallerIdFromCookies(): number | null {
  const cookieStore = cookies()
  const token = cookieStore.get(COOKIE)?.value
  if (!token) return null
  return verifySession(token)
}

export const SESSION_COOKIE = COOKIE
