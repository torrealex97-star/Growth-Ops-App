import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

const ALLOWED = ["admin", "director", "manager", "marketing", "editor"]

export interface AuthedUser {
  id: string
  role: string
}

/**
 * Devuelve el usuario autenticado si tiene permiso para el módulo de carruseles,
 * o null en caso contrario. Se usa en todas las rutas del módulo.
 */
export async function getCarruselUser(): Promise<AuthedUser | null> {
  const cookieStore = await cookies()
  const authed = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const {
    data: { user },
  } = await authed.auth.getUser()
  if (!user) return null

  const { data: urow } = await authed
    .from("users")
    .select("roles(key), dept_overrides, page_overrides")
    .eq("id", user.id)
    .single()
  const role = (urow?.roles as { key?: string } | null)?.key || ""

  // Acceso base por rol, o acceso aditivo por override de departamento/página.
  const deptOverrides: string[] = Array.isArray(urow?.dept_overrides) ? urow!.dept_overrides : []
  const pageOverrides: string[] = Array.isArray(urow?.page_overrides) ? urow!.page_overrides : []
  const hasOverride =
    deptOverrides.includes("marketing") ||
    pageOverrides.some((p) => p.startsWith('/carruseles'))

  if (!ALLOWED.includes(role) && !hasOverride) return null
  return { id: user.id, role }
}
