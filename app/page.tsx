'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'

interface TenantOption {
  slug: string
  name: string
}

// Selector de subcuenta. NO enumera todas las subcuentas del sistema: si estuviéramos
// autenticados, RLS solo devuelve las subcuentas a las que pertenecemos (policy
// tenants_select_member); si no lo estamos, no se lista NINGUNA — conocer los nombres de
// otros clientes no es información pública, así que anónimamente se muestra solo el
// formulario de acceso directo.
export default function HomePage() {
  const [tenants, setTenants] = useState<TenantOption[] | null>(null)
  const [autenticado, setAutenticado] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setAutenticado(!!data.user))
  }, [])

  useEffect(() => {
    if (autenticado === null) return
    const supabase = createClient()
    supabase
      .from('tenants')
      .select('slug, name')
      .eq('status', 'active')
      .order('name')
      .then(({ data }) => setTenants(data ?? []))
  }, [autenticado])

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
          <p className="text-muted-foreground text-sm">
            {autenticado
              ? 'No tienes subcuentas asignadas todavía. Pide acceso a tu administrador.'
              : 'Introduce la dirección de tu subcuenta o entra desde el enlace que te compartieron.'}
          </p>
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
