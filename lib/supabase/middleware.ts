import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Called by root middleware.ts for /<tenant>/* and /api/<tenant>/* paths that
// aren't in the public-suffix lists there. `tenant` is the resolved slug,
// used only to build the login redirect if there's no session.
export async function updateSession(request: NextRequest, tenant: string) {
  let response = NextResponse.next({ request })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const login = request.nextUrl.clone()
    login.pathname = `/${tenant}/login`
    login.search = ''
    return NextResponse.redirect(login)
  }
  return response
}
