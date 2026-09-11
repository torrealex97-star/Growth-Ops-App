import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { AppRole } from '@/lib/auth/permissions'

/**
 * Server-side session check for API routes. Returns the authenticated user's
 * id + role, or a ready-to-return 401/403 NextResponse.
 */
export async function requireUser(allowedRoles?: AppRole[]): Promise<
  { user: { id: string; role: AppRole } } | { error: NextResponse }
> {
  const cookieStore = await cookies()
  const authed = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await authed.auth.getUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  }
  const { data: urow } = await authed.from('users').select('roles(key)').eq('id', user.id).single()
  const role = ((urow?.roles as { key?: string } | null)?.key ?? '') as AppRole
  if (allowedRoles && !allowedRoles.includes(role)) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return { user: { id: user.id, role } }
}
