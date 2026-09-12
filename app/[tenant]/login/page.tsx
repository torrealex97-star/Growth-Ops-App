'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useTenantBranding } from '@/lib/tenant-context'
import { Loader2, Mail, Lock } from 'lucide-react'

export default function LoginPage({ params }: { params: { tenant: string } }) {
  const tenant = params.tenant
  const branding = useTenantBranding()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

      if (authError) {
        setError(authError.message)
        setLoading(false)
        return
      }

      // Verificación de membresía: RLS en `tenants` solo devuelve la fila si el
      // usuario es miembro de esta subcuenta o es super_admin de plataforma.
      // Credenciales válidas para OTRA subcuenta no bastan — sin fila, no entra.
      const { data: tenantRow } = await supabase.from('tenants').select('id, status').eq('slug', tenant).maybeSingle()

      if (!tenantRow || tenantRow.status !== 'active') {
        await supabase.auth.signOut()
        setError('No tienes acceso a esta subcuenta.')
        setLoading(false)
        return
      }

      window.location.href = `/${tenant}/dashboard`
    } catch {
      setError('Error de conexión. Inténtalo de nuevo.')
      setLoading(false)
    }
  }

  return (
    <div
      className="dark relative min-h-screen bg-background flex items-center justify-center p-4 overflow-hidden"
      data-theme="os"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_-10%,rgba(255,255,255,0.06),transparent_70%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(70% 60% at 50% 30%, #000, transparent)',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="mb-3 flex items-center gap-3">
            <span className="text-5xl font-semibold leading-none tracking-[-0.16em] text-white">S</span>
            <span className="text-2xl font-semibold tracking-tight text-white">{branding.name}</span>
          </div>
          <p className="text-muted-foreground text-sm mt-1 font-display">{tenant}</p>
        </div>

        <div className="bg-card/70 backdrop-blur-xl border border-border rounded-2xl p-7 shadow-2xl shadow-black/40">
          <h2 className="text-lg font-semibold text-foreground mb-1">Iniciar sesión</h2>
          <p className="text-muted-foreground text-sm mb-6">Introduce tus credenciales para continuar</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@email.com"
                  required
                  autoComplete="email"
                  className="w-full pl-9 pr-3 py-2.5 bg-background/60 border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-white focus:ring-2 focus:ring-white/15 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full pl-9 pr-3 py-2.5 bg-background/60 border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-white focus:ring-2 focus:ring-white/15 transition-all"
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-white hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>

          <div className="mt-5 text-center">
            <Link
              href={`/${tenant}/recover`}
              className="text-sm text-muted-foreground hover:text-white transition-colors"
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">{branding.name} · Acceso privado del equipo</p>
      </div>
    </div>
  )
}
