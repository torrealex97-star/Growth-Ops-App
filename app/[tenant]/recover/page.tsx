'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TrendingUp, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant, useTenantBranding } from '@/lib/tenant-context'

export default function RecoverPage() {
  const tenant = useTenant()
  const branding = useTenantBranding()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    // 1) Intento robusto: enlace token_hash + email propio (Resend), server-side.
    try {
      const res = await fetch(`/api/${tenant}/evergreen/auth/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (res.ok && data.ok && !data.fallback) {
        setSent(true)
        setLoading(false)
        return
      }
    } catch {
      /* si el endpoint falla, usamos el fallback de Supabase */
    }

    // 2) Fallback: flujo estándar de Supabase (mismo dispositivo).
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/api/${tenant}/evergreen/auth/callback?next=/${tenant}/settings/password`,
    })

    if (error) {
      toast.error('Error al enviar el correo', { description: error.message })
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center p-4" data-theme="os">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-brand-600 flex items-center justify-center mb-4">
            <TrendingUp className="w-6 h-6 text-foreground" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">{branding.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">Panel Comercial Interno</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-xl p-6">
          {sent ? (
            <div className="flex flex-col items-center text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-4" />
              <h2 className="text-lg font-semibold text-foreground mb-2">Correo enviado</h2>
              <p className="text-muted-foreground text-sm mb-6">
                Hemos enviado un enlace de recuperación a <span className="text-foreground">{email}</span>. Revisa tu
                bandeja de entrada.
              </p>
              <Link href={`/${tenant}/login`} className="text-sm text-brand-400 hover:text-brand-300 transition-colors">
                Volver al inicio de sesión
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-foreground mb-1">Recuperar contraseña</h2>
              <p className="text-muted-foreground text-sm mb-6">
                Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="tu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    'Enviar enlace'
                  )}
                </Button>
              </form>

              <div className="mt-4 text-center">
                <Link
                  href={`/${tenant}/login`}
                  className="text-sm text-muted-foreground hover:text-brand-400 transition-colors"
                >
                  Volver al inicio de sesión
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
