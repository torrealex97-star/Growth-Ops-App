import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Los testimonios los CONSULTA todo el equipo de ventas (los necesitan en llamada),
// pero solo los EDITA dirección/marketing.
const CAN_READ = [
  'admin',
  'director',
  'manager',
  'marketing',
  'editor',
  'setter',
  'closer',
  'triager',
  'cold_caller',
  'csm',
]
const CAN_WRITE = ['admin', 'director', 'manager', 'marketing', 'editor']

export interface TestimonioUser {
  id: string
  role: string
  canWrite: boolean
}

/** Devuelve el usuario si puede al menos leer testimonios, o null. */
export async function getTestimonioUser(): Promise<TestimonioUser | null> {
  const cookieStore = await cookies()
  const authed = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll() {},
    },
  })
  const {
    data: { user },
  } = await authed.auth.getUser()
  if (!user) return null

  const { data: urow } = await authed
    .from('users')
    .select('roles(key), dept_overrides, page_overrides')
    .eq('id', user.id)
    .single()
  const role = (urow?.roles as { key?: string } | null)?.key || ''

  const deptOverrides: string[] = Array.isArray(urow?.dept_overrides) ? urow!.dept_overrides : []
  const pageOverrides: string[] = Array.isArray(urow?.page_overrides) ? urow!.page_overrides : []
  const hasOverride =
    deptOverrides.includes('marketing') ||
    deptOverrides.includes('ventas') ||
    pageOverrides.some((p) => p.startsWith('/testimonios'))

  if (!CAN_READ.includes(role) && !hasOverride) return null
  return { id: user.id, role, canWrite: CAN_WRITE.includes(role) || deptOverrides.includes('marketing') }
}
