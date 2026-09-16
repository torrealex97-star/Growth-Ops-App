'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'

interface TenantOption {
  slug: string
  name: string
}

// Selector de subcuenta: lista las subcuentas activas para que el usuario elija a
// cuál entrar, en vez de tener que conocer/pegar el enlace directo /<tenant>/login.
export default function HomePage() {
  const [tenants, setTenants] = useState<TenantOption[] | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('tenants')
      .select('slug, name')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => setTenants(data ?? []))
  }, [])

  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center p-4" data-theme="os">
      <div className="w-full max-w-sm text-center">
        <span className="text-3xl font-semibold tracking-tight text-white">Growth Ops</span>
        <p className="text-muted-foreground text-sm mt-2 mb-8">Elige tu subcuenta para entrar.</p>

        {tenants === null && (
          <div className="flex justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {tenants !== null && tenants.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay subcuentas disponibles todavía.</p>
        )}

        {tenants !== null && tenants.length > 0 && (
          <div className="space-y-2">
            {tenants.map((t) => (
              <Link
                key={t.slug}
                href={`/${t.slug}/login`}
                className="block w-full rounded-lg border border-[#26262A] bg-[#141416] px-4 py-3 text-left text-white text-sm font-medium hover:bg-[#1C1C1F] hover:border-[#343438] transition-colors"
              >
                {t.name}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
