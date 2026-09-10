import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const publicPaths = ['/', '/login', '/auth/callback']

export async function updateSession(request: NextRequest) {
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
  const isPublic = publicPaths.includes(request.nextUrl.pathname)
  if (!user && !isPublic) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    login.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(login)
  }
  if (user && request.nextUrl.pathname === '/login') {
    const dashboard = request.nextUrl.clone()
    dashboard.pathname = '/dashboard'
    dashboard.search = ''
    return NextResponse.redirect(dashboard)
  }
  return response
}
