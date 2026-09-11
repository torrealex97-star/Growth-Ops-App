"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TrendingUp, Loader2, CheckCircle2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'

// Modos:
//  - 'token'   → llegó por enlace de invitación/recuperación (?token_hash&type).
//                Se establece la contraseña 100% en servidor (verifyOtp+updateUser),
//                sin depender de cookies del navegador → funciona en cualquier móvil.
//  - 'session' → usuario con sesión activa (enlace antiguo vía callback).
//  - 'invalid' → ni token ni sesión.
type Mode = 'loading' | 'token' | 'session' | 'invalid'

export default function SetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [mode, setMode] = useState<Mode>('loading')
  const [tokenHash, setTokenHash] = useState<string | null>(null)
  const [otpType, setOtpType] = useState<string | null>(null)

  useEffect(() => {
    const init = async () => {
      // 1) ¿Viene con token en la URL? (query o hash, por si acaso)
      const params = new URLSearchParams(window.location.search)
      const th = params.get('token_hash')
      const ty = params.get('type')
      if (th && ty) {
        setTokenHash(th)
        setOtpType(ty)
        setMode('token')
        return
      }
      // 2) Si no, ¿hay sesión activa? (flujo antiguo por callback)
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      setMode(session ? 'session' : 'invalid')
    }
    init()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('La contraseña debe tener al menos 8 caracteres')
      return
    }
    if (password !== confirm) {
      toast.error('Las contraseñas no coinciden')
      return
    }
    setLoading(true)

    if (mode === 'token') {
      // Todo en servidor: no dependemos de la sesión del navegador.
      try {
        const res = await fetch('/api/evergreen/auth/set-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token_hash: tokenHash, type: otpType, password }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          toast.error('No se pudo guardar la contraseña', { description: data.error })
          setLoading(false)
          return
        }
        setDone(true)
        setLoading(false)
        toast.success('Contraseña creada. Inicia sesión con ella.')
        setTimeout(() => router.push('/evergreen/login'), 1800)
      } catch (err) {
        toast.error('No se pudo guardar la contraseña', { description: err instanceof Error ? err.message : undefined })
        setLoading(false)
      }
      return
    }

    // Modo sesión (usuario ya autenticado).
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      toast.error('No se pudo cambiar la contraseña', { description: error.message })
      setLoading(false)
      return
    }
    setDone(true)
    setLoading(false)
    toast.success('Contraseña actualizada')
    setTimeout(() => router.push('/evergreen/dashboard'), 1500)
  }

  return (
    <div className="dark min-h-[70vh] flex items-center justify-center p-4" data-theme="os">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-brand-600 flex items-center justify-center mb-4">
            <TrendingUp className="w-6 h-6 text-foreground" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Scalix Systems</h1>
          <p className="text-muted-foreground text-sm mt-1">Nueva contraseña</p>
        </div>

        <div className="bg-card border border-border rounded-xl p-6">
          {done ? (
            <div className="flex flex-col items-center text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-4" />
              <h2 className="text-lg font-semibold text-foreground mb-2">Contraseña lista</h2>
              <p className="text-muted-foreground text-sm">
                {mode === 'token' ? 'Redirigiendo al inicio de sesión…' : 'Redirigiendo al panel…'}
              </p>
            </div>
          ) : mode === 'invalid' ? (
            <div className="flex flex-col items-center text-center py-4">
              <KeyRound className="w-12 h-12 text-amber-400 mb-4" />
              <h2 className="text-lg font-semibold text-foreground mb-2">Enlace no válido o caducado</h2>
              <p className="text-muted-foreground text-sm mb-6">
                El enlace de acceso ha expirado o no es válido. Pide uno nuevo.
              </p>
              <Link href="/evergreen/recover" className="text-sm text-brand-400 hover:text-brand-300 transition-colors">
                Solicitar nuevo enlace
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-foreground mb-1">Establece tu nueva contraseña</h2>
              <p className="text-muted-foreground text-sm mb-6">Mínimo 8 caracteres.</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Nueva contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Repite la contraseña</Label>
                  <Input
                    id="confirm"
                    type="password"
                    placeholder="••••••••"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading || mode === 'loading'}>
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Guardando…
                    </>
                  ) : (
                    'Guardar contraseña'
                  )}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
