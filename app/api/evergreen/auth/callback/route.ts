import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

// Callback de enlaces de email (invitación, recuperación, confirmación).
// Soporta AMBOS flujos de Supabase:
//   - PKCE:  ?code=...            → exchangeCodeForSession
//   - OTP:   ?token_hash=&type=   → verifyOtp  (invite / recovery / signup / email)
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = (searchParams.get('type') as EmailOtpType | null) ?? undefined
  const next = searchParams.get('next') ?? '/evergreen/dashboard'

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: Parameters<typeof cookieStore.set>[2] }[]) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )

  let ok = false
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    ok = !error
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    ok = !error
  }

  if (ok) return NextResponse.redirect(`${origin}${next}`)
  return NextResponse.redirect(`${origin}/evergreen/login?error=auth_callback_failed`)
}
