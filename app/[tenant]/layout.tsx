'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, usePathname, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sidebar } from '@/components/os/Sidebar'
import { Header } from '@/components/os/Header'
import { allowedPrefixesFor, isLeadership, type AppRole } from '@/lib/auth/permissions'
import { TenantProvider } from '@/lib/tenant-context'
import { resolveTenantBranding, type TenantBranding } from '@/lib/tenant-branding'
import { performLogout } from '@/lib/auth/logout'
import type { User } from '@/lib/types/database'
import { FileSignature, LogOut } from 'lucide-react'
import { ScriptQueueProvider } from '@/components/os/ScriptQueue'
import { AgentLauncher } from '@/components/ai/AgentLauncher'
import { isAllowedLocation, permissionLocationFor } from '@/lib/marketing-navigation'
import { AppLoading } from '@/components/ui/carga/AppLoading'
import { esperarConAbort, pedir } from '@/lib/ui/pedir'

// Rutas confidenciales SOLO para liderazgo (admin/director/manager), aunque el admin
// haya concedido por error un override de departamento/página que las abriría por prefijo.
// Relativas al tenant (sin el segmento [tenant]).
const LEADERSHIP_ONLY_PREFIXES = ['/contratos/equipo', '/contratos/plantillas']

type UserWithRole = User & { roles: { key: string; name: string } }

const AUTH_ROUTES = ['/login', '/recover']
// Rutas públicas que se renderizan sin shell ni sesión (además de las de auth), relativas al tenant.
const PUBLIC_PREFIXES = ['/afiliados/registro']

// Roles que NO pueden acceder al panel sin tener el contrato firmado.
const CONTRACT_GATED_ROLES: AppRole[] = ['closer', 'setter', 'affiliate']

type ContractGate = { pendingToken: string | null }

// Next.js 15: `params` pasa a ser una Promise en Server Components, pero este layout es Client
// Component ('use client') — en vez de desenvolverla con React.use() (requiere React 19, y este
// proyecto sigue en React 18), se usa useParams() de next/navigation, que sigue siendo síncrono.
export default function TenantLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ tenant: string }>()
  const tenant = params.tenant
  const [user, setUser] = useState<UserWithRole | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [noProfile, setNoProfile] = useState(false)
  const [noTenantAccess, setNoTenantAccess] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [branding, setBranding] = useState<TenantBranding>(() => resolveTenantBranding(null))
  const [contractGate, setContractGate] = useState<ContractGate | null>(null)
  // EL FALLO TENÍA QUE PODER VERSE. Antes, si la resolución de sesión/tenant fallaba, no había ningún
  // estado para contarlo: `loading` se quedaba en true y la pantalla no volvía nunca.
  const [fallo, setFallo] = useState<string | null>(null)
  // Cambiar esto vuelve a lanzar la resolución. Es lo que hace que "Reintentar" reintente de verdad
  // en vez de recargar la página entera y perder el sitio donde estaba la persona.
  const [intento, setIntento] = useState(0)
  const router = useRouter()
  const pathname = usePathname()
  // Ruta relativa al tenant, sin el segmento /<tenant> — todas las comparaciones
  // de zonas/overrides usan esta forma "portable" (igual en cualquier subcuenta).
  const relPathname = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const relLocation = permissionLocationFor(relPathname)

  const isAuthRoute = AUTH_ROUTES.includes(relPathname) || PUBLIC_PREFIXES.some((p) => relPathname.startsWith(p))

  // Red de seguridad: si un diálogo Radix (AlertDialog/Dialog) navega con router.push sin haberse
  // cerrado antes, deja `<body style="pointer-events:none">` colgado (Next.js no recarga la página
  // en navegación client-side, así que ese estilo persiste). Eso bloquea clics en cualquier control
  // de la página destino, p.ej. los filtros de ventas. Lo limpiamos en cada cambio de ruta.
  useEffect(() => {
    document.body.style.pointerEvents = ''
  }, [pathname])

  // Acento de color por tenant (Fase 10): en <html>, no en un wrapper interno, porque las
  // pantallas de login/recover/carga/error se renderizan FUERA del shell (antes de que exista
  // ningún contenedor propio de esta subcuenta) y deben verse igual de rebrandeadas que el resto.
  useEffect(() => {
    document.documentElement.dataset.accent = branding.accent
  }, [branding.accent])

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
    let comprobacionPendiente: ReturnType<typeof setTimeout> | null = null
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
      if (comprobacionPendiente) clearTimeout(comprobacionPendiente)
      comprobacionPendiente = setTimeout(clearIfStuck, 50)
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] })
    return () => {
      observer.disconnect()
      if (comprobacionPendiente) clearTimeout(comprobacionPendiente)
    }
  }, [])

  // Branding: se resuelve SIEMPRE, incluso en login/recover — esas páginas están fuera del
  // `if (isAuthRoute)` de más abajo (que corta antes de tocar Supabase para no exigir sesión
  // donde no la hay), pero también deben verse con la marca/acento de esta subcuenta.
  useEffect(() => {
    let mounted = true
    const cancelar = new AbortController()
    void Promise.resolve(
      createClient().from('tenants').select('settings').eq('slug', tenant).abortSignal(cancelar.signal).maybeSingle()
    )
      .then(({ data }) => {
        if (mounted && !cancelar.signal.aborted && data) setBranding(resolveTenantBranding(data.settings))
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return
        // La marca tiene fallback local; un fallo aquí no debe tumbar el shell ni quedar sin manejar.
      })
    return () => {
      mounted = false
      cancelar.abort()
    }
  }, [tenant])

  useEffect(() => {
    // Skip auth/tenant checks on login/recover pages
    if (isAuthRoute) {
      setLoading(false)
      return
    }

    let mounted = true
    const cancelar = new AbortController()

    // TECHO DE TIEMPO. Sin esto, una consulta que no responde nunca (arranque en frío de Supabase, red
    // móvil que se cae a mitad) dejaba la pantalla cargando indefinidamente: no hacía falta ni un error,
    // bastaba con que el await no se resolviera jamás.
    const TIMEOUT_MS = 12_000
    const porTiempo = setTimeout(() => {
      if (!mounted) return
      cancelar.abort()
      setFallo('No se ha podido cargar tu espacio: la conexión ha tardado demasiado.')
      setLoading(false)
    }, TIMEOUT_MS)

    const fetchUser = async () => {
      const supabase = createClient()
      const {
        data: { user: authUser },
      } = await esperarConAbort(supabase.auth.getUser(), cancelar.signal)

      if (!mounted || cancelar.signal.aborted) return
      if (!authUser) {
        router.push(`/${tenant}/login`)
        // EL BUG DE LA PANTALLA NEGRA, en una línea. Este `return` salía SIN apagar `loading`, apostando
        // a que la redirección desmontaría el componente. Cuando no lo hace —ya se está en esa ruta, la
        // navegación se traga, el router aún no está listo— queda una pantalla cargando para siempre.
        setLoading(false)
        return
      }

      // Autorización real: RLS en `tenants` solo devuelve la fila si el usuario
      // es miembro de este tenant o es super_admin de plataforma (ver
      // supabase/migrations/20260911140000_multi_tenant_foundation.sql).
      // Si no hay fila, no tiene acceso a esta subcuenta — RLS es la última
      // línea de defensa aunque este check corra en cliente.
      const { data: tenantRow, error: tenantErr } = await supabase
        .from('tenants')
        .select('id, status')
        .eq('slug', tenant)
        .abortSignal(cancelar.signal)
        .maybeSingle()

      if (!mounted || cancelar.signal.aborted) return

      // Un error de consulta NO es "no tienes acceso": decirle a alguien que no tiene acceso cuando lo
      // que ha fallado es la red le manda a pedir permisos que ya tiene.
      if (tenantErr) throw new Error(tenantErr.message)

      if (!tenantRow || tenantRow.status !== 'active') {
        setNoTenantAccess(true)
        setLoading(false)
        return
      }

      setTenantId(tenantRow.id)

      // EN PARALELO. Eran dos await encadenados y ninguno dependía del otro: se pagaban dos viajes de
      // red seguidos antes de pintar un solo píxel, en CADA entrada al panel.
      const [{ data: superAdminCheck }, { data, error }] = await Promise.all([
        supabase.rpc('is_super_admin').abortSignal(cancelar.signal),
        supabase
          .from('users')
          .select('*, roles(key, name)')
          .eq('id', authUser.id)
          .abortSignal(cancelar.signal)
          .single(),
      ])

      if (!mounted || cancelar.signal.aborted) return
      setIsSuperAdmin(!!superAdminCheck)

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
        // `pedir` no lanza y trae timeout propio: si la comprobación del contrato se cuelga, no se lleva
        // por delante el arranque de toda la aplicación.
        const res = await pedir<{ hasSigned?: boolean; pendingToken?: string | null }>(
          `/api/${tenant}/evergreen/contracts/my-status`,
          { signal: cancelar.signal }
        )
        if (!mounted || cancelar.signal.aborted) return
        if (res.ok && res.data?.hasSigned === false) {
          setContractGate({ pendingToken: res.data.pendingToken ?? null })
          setUser(data as UserWithRole)
          setLoading(false)
          return
        }
        // Si la comprobación falla, no se bloquea (fail-open) para no dejar fuera al colaborador por un
        // error transitorio de red.
      }

      if (!mounted || cancelar.signal.aborted) return
      setUser(data as UserWithRole)
    }

    setFallo(null)
    setLoading(true)
    fetchUser()
      .catch((e: unknown) => {
        // EL CATCH QUE NO EXISTÍA. Cualquier excepción —red caída, CORS, 500 de Supabase— abortaba la
        // función a mitad y nadie apagaba `loading`. Ahora el fallo se ve y se puede reintentar.
        if (!mounted || cancelar.signal.aborted) return
        const nombre = e instanceof Error ? e.name : ''
        if (nombre === 'AbortError') return // lo gestiona el timeout o el desmontaje
        setFallo(e instanceof Error ? e.message : 'No se ha podido cargar tu espacio.')
      })
      .finally(() => {
        // Y EL FINALLY. Pase lo que pase por cualquiera de los caminos, el loader se apaga.
        clearTimeout(porTiempo)
        if (mounted && !cancelar.signal.aborted) setLoading(false)
      })

    return () => {
      mounted = false
      clearTimeout(porTiempo)
      cancelar.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthRoute, tenant, intento])

  // Roles acotados por departamento: cada uno solo accede a su zona.
  // Excepción: la página de cambio de contraseña es accesible por cualquier rol
  // autenticado (se llega desde el enlace de recuperación).
  useEffect(() => {
    if (contractGate) return // bloqueado por contrato: no redirigir a zonas
    if (isSuperAdmin) return // super_admin no está acotado por zonas de departamento
    const role = user?.roles?.key as AppRole | undefined
    if (!role) return
    if (relPathname.startsWith('/settings/password')) return
    if (relPathname.startsWith('/perfil')) return // perfil propio: cualquier rol
    // Blindaje contratos de equipo / plantillas: solo liderazgo. Protege frente a
    // errores humanos al asignar accesos a closers.
    if (LEADERSHIP_ONLY_PREFIXES.some((p) => relPathname.startsWith(p)) && !isLeadership(role)) {
      router.replace(`/${tenant}/dashboard`)
      return
    }
    const u = user as { dept_overrides?: string[] | null; page_overrides?: string[] | null }
    const zones = allowedPrefixesFor(role, u?.dept_overrides, u?.page_overrides)
    if (zones && zones.length > 0 && !isAllowedLocation(zones, relLocation)) {
      router.replace(`/${tenant}${zones[0]}`)
    }
  }, [user, relPathname, relLocation, router, contractGate, isSuperAdmin, tenant])

  // La sesión que las pantallas van a reutilizar. Se construye de lo que este layout YA cargó para
  // decidir si dejarlas entrar: sin esto, cada pantalla repetía `auth.getUser()` + `from('users')` para
  // releer lo mismo, en serie y antes de pedir sus propios datos.
  // useMemo NO es cosmético aquí: las pantallas ponen `sesion` en las dependencias de su efecto de
  // carga, y un objeto nuevo en cada render del layout sería una referencia nueva cada vez → el efecto
  // se volvería a disparar sin parar y la pantalla recargaría en bucle.
  const sesion = useMemo(
    () => (user ? { userId: user.id, user, rol: user.roles?.key ?? null, isSuperAdmin } : null),
    [user, isSuperAdmin]
  )

  // Auth pages render without sidebar
  if (isAuthRoute) {
    return (
      <TenantProvider tenant={tenant} tenantId={tenantId} branding={branding} sesion={sesion}>
        <div className="dark">{children}</div>
      </TenantProvider>
    )
  }

  // EL FALLO, ANTES DEL LOADER. Si la resolución falló, se enseña el motivo y una salida — no un loader
  // que no va a terminar nunca.
  if (fallo) {
    return (
      <div className="dark flex h-screen items-center justify-center bg-background px-4">
        <div role="alert" className="max-w-sm text-center">
          <h2 className="mb-2 text-lg font-semibold text-foreground">No se ha podido cargar {branding.name}</h2>
          <p className="mb-6 text-sm text-muted-foreground">{fallo}</p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => setIntento((n) => n + 1)}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={() => router.push(`/${tenant}/login`)}
              className="rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Volver a entrar
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    // Ya no es un rectángulo pulsando sobre negro con la palabra "Cargando": es el loader de marca, no
    // aparece si la carga dura menos de 300 ms, y a los 6 segundos ofrece reintentar en vez de quedarse.
    return (
      <div className="dark flex h-screen items-center justify-center bg-background">
        <AppLoading
          mensaje={`Preparando ${branding.name}…`}
          onReintentar={() => setIntento((n) => n + 1)}
          onVolver={() => router.push(`/${tenant}/login`)}
        />
      </div>
    )
  }

  if (noTenantAccess) {
    return (
      <div className="dark flex h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center">
          <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          </div>
          <h2 className="text-foreground font-semibold text-lg mb-2">Sin acceso a esta subcuenta</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Tu cuenta no tiene acceso a &ldquo;{tenant}&rdquo;, o esta subcuenta no existe.
          </p>
          <button
            onClick={() => performLogout(`/${tenant}/login`)}
            className="text-brand-400 hover:text-brand-300 text-sm transition-colors"
          >
            ← Cerrar sesión
          </button>
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          </div>
          <h2 className="text-foreground font-semibold text-lg mb-2">Sin perfil de usuario</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Tu cuenta de Supabase existe pero no tiene un perfil en la base de datos. Aplica el schema desde el panel de
            Supabase o contacta con el administrador.
          </p>
          <button
            onClick={() => router.push(`/${tenant}/login`)}
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
    const handleLogout = () => performLogout(`/${tenant}/login`)
    return (
      <div className="dark flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto mb-6">
            <FileSignature className="w-10 h-10 text-amber-400" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-3">Te falta firmar el contrato</h1>
          <p className="text-muted-foreground text-base leading-relaxed mb-2">
            Hola {user.full_name?.split(' ')[0] || ''}, para poder acceder a tu cuenta primero necesitas{' '}
            <span className="text-foreground font-medium">firmar tu contrato</span>.
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
    <TenantProvider tenant={tenant} tenantId={tenantId} branding={branding} sesion={sesion}>
      <ScriptQueueProvider>
        <div className="flex h-screen bg-background text-foreground overflow-hidden" data-theme="os">
          <Sidebar user={user} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <Header user={user} onMenuClick={() => setSidebarOpen(true)} isSuperAdmin={isSuperAdmin} />
            <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
          </div>
        </div>
        <AgentLauncher />
      </ScriptQueueProvider>
    </TenantProvider>
  )
}
