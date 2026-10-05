import { createBrowserClient } from '@supabase/ssr'
import { fetchSupabaseWithTimeout } from '@/lib/supabase/fetch-with-timeout'

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: fetchSupabaseWithTimeout },
  })
}
