'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useTenantBranding } from '@/lib/tenant-context'
import { ShaderBackground } from '@/components/ui/mesh-drift-shader'
import { Loader2, Mail, Lock } from 'lucide-react'

// Next.js 15: `params` pasa a ser una Promise — useParams() de next/navigation sigue siendo
// síncrono en Client Components, evita React.use() (requiere React 19).
export default function LoginPage() {
  const { tenant } = useParams<{ tenant: string }>()
  const branding = useTenantBranding()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // EXISTE LA SUBCUENTA? Antes el formulario se pintaba igual para un slug inexistente: escribías
  // usuario y contraseña, y solo DESPUÉS de enviarlos salía "No tienes acceso a esta subcuenta" —
  // un mensaje que hace pensar en permisos cuando en realidad es una errata en la URL. Una `s` de
  // más en el slug costó una sesión entera de diagnóstico. Se comprueba antes de pedir nada.
  const [subcuenta, setSubcuenta] = useState<'comprobando' | 'existe' | 'desconocida'>('comprobando')

  useEffect(() => {
    if (!tenant) return
    let vigente = true
    // Misma RPC que usa el shell para la marca: SECURITY DEFINER, solo devuelve fila si el slug
    // existe Y está activo. Cero filas = no existe o está inactiva. No enumera nada: hay que
    // acertar el slug para obtener respuesta, igual que ya ocurría con el branding.
    createClient()
      .rpc('public_tenant_branding', { p_slug: tenant })
      .then(({ data, error: rpcError }: { data: unknown[] | null; error: unknown }) => {
        if (!vigente) return
        // Ante un fallo de red no se bloquea el acceso: se deja pasar al formulario y que decida
        // el intento real. Negar la entrada por un error transitorio sería peor que el problema.
        if (rpcError) return setSubcuenta('existe')
        setSubcuenta(data && data.length > 0 ? 'existe' : 'desconocida')
      })
    return () => {
      vigente = false
    }
  }, [tenant])

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

      // Se recuerda en ESTE navegador para ofrecerla de un clic en la home. Es el historial del
      // propio usuario, no un listado del sistema: no revela ninguna subcuenta ajena y por tanto no
      // roza la regla de no-enumeración (`tests/tenant-no-enumeration.test.mjs`).
      try {
        localStorage.setItem('gop:ultima-subcuenta', tenant)
      } catch {
        // Modo privado o almacenamiento bloqueado: el atajo es una comodidad, nunca un requisito.
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
      {/* Fondo animado (WebGL). aria-hidden + pointer-events-none: es decorativo y no debe
          interceptar clics del formulario — el shader sigue el puntero desde window, así que la
          interacción no se pierde. motion-reduce:hidden lo oculta con prefers-reduced-motion, y al
          quedar en display:none su IntersectionObserver detiene además el bucle de render. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
        <ShaderBackground className="h-full w-full" />
      </div>
      {/* Velo: mantiene legible el formulario sobre un fondo que se mueve y cambia de luminosidad. */}
      <div className="pointer-events-none absolute inset-0 bg-background/30" />
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
          {subcuenta === 'desconocida' ? (
            /* Subcuenta inexistente o inactiva: se dice ANTES de pedir credenciales, y se nombra la
               causa más probable —una errata en la dirección— en vez de insinuar un problema de
               permisos. No se revela ninguna otra subcuenta: solo se confirma que ESTA no vale. */
            <div className="text-center">
              <h2 className="text-lg font-semibold text-foreground mb-2">Esta subcuenta no existe</h2>
              <p className="text-muted-foreground text-sm mb-6">
                No hay ninguna subcuenta activa con el identificador{' '}
                <span className="font-display text-foreground">{tenant}</span>. Suele ser una errata en la dirección:
                revisa singulares y plurales, y los guiones.
              </p>
              <Link
                href="/"
                className="inline-flex items-center justify-center w-full h-11 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
              >
                Ir al selector de subcuenta
              </Link>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">{branding.name} · Acceso privado del equipo</p>
      </div>
    </div>
  )
}
