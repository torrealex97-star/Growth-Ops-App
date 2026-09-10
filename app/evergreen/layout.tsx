"use client"

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from '@/components/os/Sidebar'
import { Header } from '@/components/os/Header'
import { allowedPrefixesFor, isLeadership, type AppRole } from '@/lib/auth/permissions'

// Rutas confidenciales SOLO para liderazgo (admin/director/manager), aunque el admin
// haya concedido por error un override de departamento/página que las abriría por prefijo.
const LEADERSHIP_ONLY_PREFIXES = ['/evergreen/contratos/equipo', '/evergreen/contratos/plantillas']
import { performLogout } from '@/lib/auth/logout'
import type { User } from '@/lib/types/database'
import { FileSignature, LogOut } from 'lucide-react'
import { ScriptQueueProvider } from '@/components/os/ScriptQueue'

type UserWithRole = User & { roles: { key: string; name: string } }

const AUTH_ROUTES = ['/evergreen/login', '/evergreen/recover']
// Rutas públicas que se renderizan sin shell ni sesión (además de las de auth).
const PUBLIC_PREFIXES = ['/evergreen/afiliados/registro']

// Roles que NO pueden acceder al panel sin tener el contrato firmado.
const CONTRACT_GATED_ROLES: AppRole[] = ['closer', 'setter', 'affiliate']

type ContractGate = { pendingToken: string | null }

export default function EvergreenLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserWithRole | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [noProfile, setNoProfile] = useState(false)
  const [contractGate, setContractGate] = useState<ContractGate | null>(null)
  const router = useRouter()
  const pathname = usePathname()

  const isAuthRoute =
    AUTH_ROUTES.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))

  // Red de seguridad: si un diálogo Radix (AlertDialog/Dialog) navega con router.push sin haberse
  // cerrado antes, deja `<body style="pointer-events:none">` colgado (Next.js no recarga la página
  // en navegación client-side, así que ese estilo persiste). Eso bloquea clics en cualquier control
  // de la página destino, p.ej. los filtros de /evergreen/sales. Lo limpiamos en cada cambio de ruta.
  useEffect(() => {
    document.body.style.pointerEvents = ''
  }, [pathname])

  // La red de seguridad anterior solo actuaba al cambiar de RUTA. Pero el bug reportado
  // ("se queda bloqueada la app al usar los filtros de Ventas") ocurre SIN navegar: al
  // abrir/cerrar un <Select> de Radix (Setter/Closer/Producto/Periodo), Radix pone
  // `pointer-events: none` en el body mientras el desplegable está abierto, y si el cierre
  // no limpia bien (carrera con el re-render al cambiar el filtro), ese estilo se queda
  // pegado para siempre y bloquea CUALQUIER clic en toda la página — sin ningún error visible
  // en consola, porque no es una excepción, es solo un estilo colgado.
  // Aquí vigilamos el body en todo momento: si queda con pointer-events:none y no hay ningún
  // overlay de Radix realmente abierto (Select/Dialog/Popover/DropdownMenu), lo limpiamos.
  useEffect(() => {
    const clearIfStuck = () => {
      if (document.body.style.pointerEvents !== 'none') return
      const openOverlay = document.querySelector(
        '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], [role="listbox"][data-state="open"]'
      )
      if (!openOverlay) document.body.style.pointerEvents = ''
    }
    const observer = new MutationObserver(() => {
      // Pequeño margen: Radix a veces pone pointer-events:none un instante antes de montar
      // el overlay, así que comprobamos en el siguiente tick en vez de al vuelo.
      setTimeout(clearIfStuck, 50)
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    // Skip auth check on login/recover pages
    if (isAuthRoute) {
      setLoading(false)
      return
    }

    let mounted = true
    const fetchUser = async () => {
      const supabase = createClient()
      const { data: { user: authUser } } = await supabase.auth.getUser()

      if (!authUser) {
        router.push('/evergreen/login')
        return
      }

      const { data, error } = await supabase
        .from('users')
        .select('*, roles(key, name)')
        .eq('id', authUser.id)
        .single()

      if (!mounted) return

      if (error || !data) {
        // Schema not applied or no profile — show helpful error instead of infinite loop
        setNoProfile(true)
        setLoading(false)
        return
      }

      // Bloqueo por contrato sin firmar: closer/setter/afiliado no ven nada del
      // panel hasta tener un contrato de equipo en estado "firmado". El estado se
      // consulta vía API (service role) porque la RLS de contracts no deja a esos
      // roles leer la tabla directamente.
      const roleKey = (data.roles as { key?: string } | null)?.key as AppRole | undefined
      if (roleKey && CONTRACT_GATED_ROLES.includes(roleKey)) {
        try {
          const res = await fetch('/api/evergreen/contracts/my-status')
          const st = await res.json()
          if (!mounted) return
          if (res.ok && !st.hasSigned) {
            setContractGate({ pendingToken: st.pendingToken ?? null })
            setUser(data as UserWithRole)
            setLoading(false)
            return
          }
        } catch {
          // Si falla la comprobación, no bloqueamos (fail-open) para no dejar
          // fuera al colaborador por un error transitorio de red.
        }
      }

      setUser(data as UserWithRole)
      setLoading(false)
    }

    fetchUser()
    return () => { mounted = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthRoute])

  // Roles acotados por departamento: cada uno solo accede a su zona.
  // Excepción: la página de cambio de contraseña es accesible por cualquier rol
  // autenticado (se llega desde el enlace de recuperación).
  useEffect(() => {
    if (contractGate) return // bloqueado por contrato: no redirigir a zonas
    const role = user?.roles?.key as AppRole | undefined
    if (!role) return
    if (pathname.startsWith('/evergreen/settings/password')) return
    if (pathname.startsWith('/evergreen/perfil')) return // perfil propio: cualquier rol
    // Blindaje contratos de equipo / plantillas: solo liderazgo. Protege frente a
    // errores humanos al asignar accesos a closers.
    if (LEADERSHIP_ONLY_PREFIXES.some((p) => pathname.startsWith(p)) && !isLeadership(role)) {
      router.replace('/evergreen/dashboard')
      return
    }
    const u = user as { dept_overrides?: string[] | null; page_overrides?: string[] | null }
    const zones = allowedPrefixesFor(role, u?.dept_overrides, u?.page_overrides)
    if (zones && zones.length > 0 && !zones.some((z) => pathname.startsWith(z))) {
      router.replace(zones[0])
    }
  }, [user, pathname, router, contractGate])

  // Auth pages render without sidebar
  if (isAuthRoute) {
    return <div className="dark">{children}</div>
  }

  if (loading) {
    return (
      <div className="dark flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-lg bg-brand-600 animate-pulse" />
          <p className="text-muted-foreground text-sm">Cargando EV - [tenant]...</p>
        </div>
      </div>
    )
  }

  if (noProfile) {
    return (
      <div className="dark flex h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="text-foreground font-semibold text-lg mb-2">Sin perfil de usuario</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Tu cuenta de Supabase existe pero no tiene un perfil en la base de datos. Aplica el schema desde el panel de Supabase o contacta con el administrador.
          </p>
          <button
            onClick={() => router.push('/evergreen/login')}
            className="text-brand-400 hover:text-brand-300 text-sm transition-colors"
          >
            ← Volver al login
          </button>
        </div>
      </div>
    )
  }

  if (!user) return null

  // Bloqueo total por contrato sin firmar (closer/setter/afiliado).
  if (contractGate) {
    const handleLogout = () => performLogout()
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-6">
            <FileSignature className="w-10 h-10 text-amber-400" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-3">Te falta firmar el contrato</h1>
          <p className="text-muted-foreground text-base leading-relaxed mb-2">
            Hola {user.full_name?.split(' ')[0] || ''}, para poder acceder a tu cuenta primero
            necesitas <span className="text-foreground font-medium">firmar tu contrato</span>.
          </p>
          <p className="text-muted-foreground text-sm mb-8">
            {contractGate.pendingToken
              ? 'Tienes un contrato pendiente de firma. Púlsalo para revisarlo y firmarlo — también te lo hemos enviado por email.'
              : 'Aún no tienes ningún contrato asignado. Contacta con administración para que te lo envíen.'}
          </p>
          <div className="flex flex-col gap-3">
            {contractGate.pendingToken && (
              <a
                href={`/firmar/${contractGate.pendingToken}`}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-semibold py-3.5 transition-colors"
              >
                <FileSignature className="w-5 h-5" /> Revisar y firmar mi contrato
              </a>
            )}
            <button
              onClick={handleLogout}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:border-border py-3 text-sm transition-colors"
            >
              <LogOut className="w-4 h-4" /> Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ScriptQueueProvider>
      <div className="flex h-screen bg-background text-foreground overflow-hidden" data-theme="os">
        <Sidebar user={user} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header user={user} onMenuClick={() => setSidebarOpen(true)} />
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
    </ScriptQueueProvider>
  )
}
