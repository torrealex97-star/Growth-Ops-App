'use client'

// VISTA ADMIN DE COLABORADORES (§45-46) — la gestión sobre la ENTIDAD ESTRUCTURADA.
//
// Antes este ranking vivía de textos (users.affiliate_code + utm_content); ahora lista
// collaborator_profiles y calcula SUS KPIs por la misma vía que todo el sistema:
//   · contactos      ← contact_attributions.collaborator_id (FK estructurada, §43)
//   · ventas/facturación ← isActiveSale sobre las ventas de SUS contactos
//   · cash           ← collections 'collected' de esas ventas (canón del motor)
//   · comisiones     ← el LEDGER real (commissions por user_id, lane 'collaborator')
// Nada de fórmulas nuevas: mismas definiciones canónicas que dashboard/comisiones.
//
// §46 filtros: periodo global (PeriodFilterBar), estado del perfil y búsqueda.
// §46 detalle: al pulsar una fila, KPIs del colaborador + sus ventas y contactos
// ENLAZADOS a las vistas existentes (contacto → CRM, venta → registro, ledger →
// Comisiones, origen → Atribución) — sin duplicar ninguna de ellas.
//
// El rol 'affiliate' (el propio colaborador) solo ve SU ficha; para admins/directores
// además permite cambiar estado vía PATCH de la ruta API ya auditada (§76).

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { KPICard } from '@/components/os/DashboardKPICard'
import { TrendingUp, ShoppingCart, Wallet, Percent, Users, Search, ArrowLeft, Copy, Check } from 'lucide-react'
import { isActiveSale } from '@/lib/analytics'
import { formatCurrency, formatDate } from '@/lib/utils'
import { enlaceDeColaborador } from '@/lib/tracking/enlaces'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { DEFAULT_PERIOD, getPeriodRange, inPeriod, PERIOD_LABELS, type PeriodPreset } from '@/lib/filters/period'
import { useTenant, useTenantId, useSesion } from '@/lib/tenant-context'
import { toast } from 'sonner'

// --- Tipos (columnas reales de la BD, ver lib/types/database-generated.ts) ---
type PerfilColaborador = {
  id: string
  user_id: string | null
  code: string | null
  name: string | null
  status: string | null
  default_commission_percent: number | string | null
  notes: string | null
  created_at: string | null
  users?:
    { full_name: string | null; email: string | null }[] | { full_name: string | null; email: string | null } | null
}
// El embed de users llega como objeto u array según cómo resuelva PostgREST la FK;
// normalizar una sola vez evita condicionales repartidas por toda la vista.
function filaDeUser(p: PerfilColaborador): { full_name: string | null; email: string | null } | null {
  const u = p.users
  if (!u) return null
  return Array.isArray(u) ? (u[0] ?? null) : u
}
type VentaRow = {
  id: string
  contact_id: string | null
  sale_date: string | null
  gross_amount: number | string | null
  status: string | null
}
type CobroRow = {
  sale_id: string | null
  gross_amount: number | string | null
  status: string | null
  collected_at: string | null
}
type ComisionRow = {
  id: string
  user_id: string | null
  participant_type: string | null
  percent: number | string | null
  commission_amount: number | string | null
  status: string | null
  created_at: string | null
}
type ContactoRow = { id: string; full_name: string | null; lead_status: string | null; created_at: string | null }

type KpiColaborador = {
  contactos: number
  ventas: number
  gross: number
  cash: number
  comisiones: number
}

const num = (x: number | string | null | undefined) => Number(x ?? 0)

// Vocabulario canónico de collaborator_profiles.status (migración 20260918150000).
const ESTADO_LABELS: Record<string, string> = {
  invited: 'Invitado',
  pending_contract: 'Contrato pendiente',
  active: 'Activo',
  suspended: 'Suspendido',
  inactive: 'Inactivo',
}
const ESTADOS_FILTRO = ['all', 'active', 'invited', 'pending_contract', 'suspended', 'inactive'] as const

const COMISION_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  liquidated: 'Liquidada',
  cancelled: 'Cancelada',
}

export default function AfiliadosPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  // Sesión ya resuelta por el layout: evita repetir auth.getUser() + from('users') aquí.
  const sesion = useSesion()
  const [loading, setLoading] = useState(true)

  const [perfiles, setPerfiles] = useState<PerfilColaborador[]>([])
  const [atribuciones, setAtribuciones] = useState<{ contact_id: string; collaborator_id: string }[]>([])
  const [ventas, setVentas] = useState<VentaRow[]>([])
  const [cobros, setCobros] = useState<CobroRow[]>([])
  const [comisiones, setComisiones] = useState<ComisionRow[]>([])

  // §46 Filtros: periodo global + estado + búsqueda.
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState<string>('all')
  const [busqueda, setBusqueda] = useState('')

  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [guardandoEstado, setGuardandoEstado] = useState<string | null>(null)

  // Enlace de referido: el destino es el base_url de una campaña activa del tenant
  // (los mismos destinos que ya usan los enlaces de /recursos/enlaces); el código
  // del colaborador personaliza la atribución vía ?utm_content + ?ref.
  const [campanas, setCampanas] = useState<{ id: string; name: string; base_url: string }[]>([])
  const [copiadoId, setCopiadoId] = useState<string | null>(null)

  const rango = useMemo(() => getPeriodRange(periodPreset, customFrom, customTo), [periodPreset, customFrom, customTo])
  const puedeGestionar = sesion?.rol === 'admin' || sesion?.rol === 'director'
  const esColaborador = sesion?.rol === 'affiliate'

  useEffect(() => {
    let mounted = true
    async function load() {
      if (!sesion || !mounted) return
      const sb = createClient()

      // La entidad estructurada es la fuente del listado (§45). Con el join a users
      // salen nombre y email sin segunda consulta.
      const { data: perfilesData } = await sb
        .from('collaborator_profiles')
        .select(
          'id, user_id, code, name, status, default_commission_percent, notes, created_at, users(full_name, email)'
        )
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (!mounted) return
      const lista = (perfilesData ?? []) as PerfilColaborador[]
      setPerfiles(lista)

      if (lista.length === 0) {
        setLoading(false)
        return
      }

      // KPIs: atribuciones estructuradas + ventas + cobros + LEDGER del propio motor.
      // Las comisiones se acotan a los user_ids de los perfiles: nunca todo el ledger.
      const userIds = lista.map((p) => p.user_id).filter((x): x is string => !!x)
      const esColab = (sesion.user as { roles?: { key?: string } | null }).roles?.key === 'affiliate'
      const [attrRes, salesRes, collRes, commRes] = await Promise.all([
        sb
          .from('contact_attributions')
          .select('contact_id, collaborator_id')
          .eq('tenant_id', tenantId)
          .not('collaborator_id', 'is', null),
        sb.from('sales').select('id, contact_id, sale_date, gross_amount, status').eq('tenant_id', tenantId),
        sb.from('collections').select('sale_id, gross_amount, status, collected_at').eq('tenant_id', tenantId),
        sb
          .from('commissions')
          .select('id, user_id, participant_type, percent, commission_amount, status, created_at')
          .eq('tenant_id', tenantId)
          .in('user_id', userIds),
      ])
      if (!mounted) return
      setAtribuciones((attrRes.data ?? []) as { contact_id: string; collaborator_id: string }[])
      setVentas((salesRes.data ?? []) as VentaRow[])
      setCobros((collRes.data ?? []) as CobroRow[])
      setComisiones((commRes.data ?? []) as ComisionRow[])

      // Destinos del enlace de referido: para admins, todas las campañas activas del
      // tenant; para el propio colaborador, SOLO sus campañas asignadas — la misma
      // regla que /recursos/enlaces aplica a sus enlaces UTM.
      if (esColab) {
        const { data: memberRows } = await sb
          .from('affiliate_campaign_members')
          .select('affiliate_campaigns(id, name, base_url, is_active)')
          .eq('affiliate_id', sesion.userId)
          .eq('tenant_id', tenantId)
        if (!mounted) return
        const asignadas = (
          (memberRows as unknown as {
            affiliate_campaigns: { id: string; name: string; base_url: string; is_active: boolean } | null
          }[]) ?? []
        )
          .map((r) => r.affiliate_campaigns)
          .filter((c): c is { id: string; name: string; base_url: string; is_active: boolean } => !!c && c.is_active)
          .map(({ id, name, base_url }) => ({ id, name, base_url }))
        setCampanas(asignadas)
      } else {
        const { data: campRes } = await sb
          .from('affiliate_campaigns')
          .select('id, name, base_url')
          .eq('tenant_id', tenantId)
          .eq('is_active', true)
        if (!mounted) return
        setCampanas((campRes ?? []) as { id: string; name: string; base_url: string }[])
      }
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
    // `sesion` entra en las dependencias: sin ella, la carga se quedaría con el valor capturado
    // en el primer render. Está memorizada en el layout, así que no provoca bucle.
  }, [sesion, tenantId])

  // --- Agregaciones (memoria: escala de una subcuenta, igual que el resto de vistas) ---
  const contactosPorPerfil = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const a of atribuciones) {
      if (!a.collaborator_id || !a.contact_id) continue
      const arr = map.get(a.collaborator_id) ?? []
      arr.push(a.contact_id)
      map.set(a.collaborator_id, arr)
    }
    return map
  }, [atribuciones])

  const kpiDePerfil = useCallback(
    (p: PerfilColaborador): KpiColaborador => {
      const contactos = contactosPorPerfil.get(p.id) ?? []
      const ids = new Set(contactos)
      const ventasP = ventas.filter(
        (v) =>
          v.contact_id &&
          ids.has(v.contact_id) &&
          isActiveSale({ status: v.status ?? '' }) &&
          inPeriod(v.sale_date, rango)
      )
      const gross = ventasP.reduce((acc, v) => acc + num(v.gross_amount), 0)
      // Cash canónico: cobros 'collected' de las ventas activas del periodo,
      // recaudados dentro del periodo (mismo criterio que el resto de vistas).
      const ventasPeriodoIds = new Set(ventasP.map((v) => v.id))
      const cashP = cobros
        .filter(
          (c) =>
            c.status === 'collected' && c.sale_id && ventasPeriodoIds.has(c.sale_id) && inPeriod(c.collected_at, rango)
        )
        .reduce((acc, c) => acc + num(c.gross_amount), 0)
      // Comisiones: el LEDGER real del motor (lane 'collaborator' o legacy), no un % estimado.
      const comisionesP = comisiones
        .filter((c) => c.user_id === p.user_id && c.status !== 'cancelled' && inPeriod(c.created_at, rango))
        .reduce((acc, c) => acc + num(c.commission_amount), 0)
      return { contactos: contactos.length, ventas: ventasP.length, gross, cash: cashP, comisiones: comisionesP }
    },
    [contactosPorPerfil, ventas, cobros, comisiones, rango]
  )

  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return perfiles
      .filter((p) => (estadoFiltro === 'all' ? true : p.status === estadoFiltro))
      .filter((p) => {
        if (!q) return true
        const u = filaDeUser(p)
        const nombre = u?.full_name ?? p.name ?? ''
        return `${nombre} ${u?.email ?? ''} ${p.code ?? ''}`.toLowerCase().includes(q)
      })
      .map((p) => ({ perfil: p, kpi: kpiDePerfil(p) }))
      .sort((a, b) => b.kpi.comisiones - a.kpi.comisiones || b.kpi.cash - a.kpi.cash)
  }, [perfiles, estadoFiltro, busqueda, kpiDePerfil])

  const totales = useMemo(
    () =>
      lista.reduce(
        (acc, { kpi }) => ({
          contactos: acc.contactos + kpi.contactos,
          ventas: acc.ventas + kpi.ventas,
          gross: acc.gross + kpi.gross,
          cash: acc.cash + kpi.cash,
          comisiones: acc.comisiones + kpi.comisiones,
        }),
        { contactos: 0, ventas: 0, gross: 0, cash: 0, comisiones: 0 }
      ),
    [lista]
  )

  const activos = useMemo(() => perfiles.filter((p) => p.status === 'active').length, [perfiles])

  const cambiarEstado = async (p: PerfilColaborador, status: string) => {
    setGuardandoEstado(p.id)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/colaboradores`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, status }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`)
      setPerfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, status } : x)))
      toast.success(`Estado actualizado: ${ESTADO_LABELS[status] ?? status}`)
    } catch (e) {
      toast.error('No se pudo cambiar el estado', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setGuardandoEstado(null)
    }
  }

  const copiarEnlace = async (perfil: PerfilColaborador) => {
    if (!perfil.code) {
      toast.error('Este colaborador aún no tiene código de referido')
      return
    }
    const destino = campanas[0]?.base_url
    if (!destino) {
      toast.error('No hay campañas activas con base_url para enlazar', {
        description: 'Crea una campaña en Colaboradores · Campañas para poder generar el enlace.',
      })
      return
    }
    const enlace = enlaceDeColaborador(destino, perfil.code)
    try {
      await navigator.clipboard.writeText(enlace)
      setCopiadoId(perfil.id)
      toast.success('Enlace copiado', { description: enlace })
      setTimeout(() => setCopiadoId(null), 2000)
    } catch {
      toast.error('No se pudo copiar al portapapeles')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-56 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-card border border-border rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-card border border-border rounded-lg animate-pulse" />
      </div>
    )
  }

  const miPerfil = esColaborador ? (perfiles.find((p) => p.user_id === sesion?.userId) ?? null) : null

  // El propio colaborador solo ve SU ficha (§51): nada de ranking del resto.
  if (esColaborador) {
    if (!miPerfil) {
      return (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          Aún no tienes perfil de colaborador activo en esta subcuenta.
        </div>
      )
    }
    return (
      <div className="space-y-6">
        <FichaColaborador
          tenant={tenant}
          perfil={miPerfil}
          kpi={kpiDePerfil(miPerfil)}
          comisiones={comisiones.filter((c) => c.user_id === miPerfil.user_id)}
          ventas={ventas}
          contactosPorPerfil={contactosPorPerfil}
          periodPreset={periodPreset}
          onVolver={null}
          onCopiar={copiarEnlace}
          copiado={copiadoId === miPerfil.id}
        />
      </div>
    )
  }

  const detalle = detalleId
    ? (lista.find((x) => x.perfil.id === detalleId) ?? perfiles.find((p) => p.id === detalleId) ?? null)
    : null
  const detallePerfil = detalle && 'perfil' in detalle ? detalle.perfil : detalle
  const detalleKpi = detallePerfil ? kpiDePerfil(detallePerfil) : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-brand-400" />
            Colaboradores
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {detallePerfil
              ? 'Detalle del colaborador con enlaces a CRM, ventas, ledger y origen.'
              : 'Listado y KPIs por colaborador sobre la atribución estructurada.'}
          </p>
        </div>
        <Link
          href={`/${tenant}/settings/afiliados`}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          Configurar programa
        </Link>
      </div>

      {detallePerfil && detalleKpi ? (
        <FichaColaborador
          tenant={tenant}
          perfil={detallePerfil}
          kpi={detalleKpi}
          comisiones={comisiones.filter((c) => c.user_id === detallePerfil.user_id)}
          ventas={ventas}
          contactosPorPerfil={contactosPorPerfil}
          periodPreset={periodPreset}
          onVolver={() => setDetalleId(null)}
          onCopiar={copiarEnlace}
          copiado={copiadoId === detallePerfil.id}
        />
      ) : (
        <>
          {/* §46 Filtros: periodo global + estado + búsqueda */}
          <div className="space-y-2">
            <PeriodFilterBar
              preset={periodPreset}
              onPresetChange={setPeriodPreset}
              customFrom={customFrom}
              customTo={customTo}
              onCustomFromChange={setCustomFrom}
              onCustomToChange={setCustomTo}
            />
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar por nombre, email o código…"
                  className="bg-background border border-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-foreground w-64 focus:outline-none focus:border-brand-500"
                />
              </div>
              <select
                value={estadoFiltro}
                onChange={(e) => setEstadoFiltro(e.target.value)}
                className="bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-brand-500"
              >
                {ESTADOS_FILTRO.map((e) => (
                  <option key={e} value={e}>
                    {e === 'all' ? 'Todos los estados' : ESTADO_LABELS[e]}
                  </option>
                ))}
              </select>
              {(estadoFiltro !== 'all' || busqueda || periodPreset !== DEFAULT_PERIOD) && (
                <button
                  type="button"
                  onClick={() => {
                    setEstadoFiltro('all')
                    setBusqueda('')
                    setPeriodPreset(DEFAULT_PERIOD)
                    setCustomFrom('')
                    setCustomTo('')
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>

          {/* KPIs agregados del periodo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KPICard
              title="Colaboradores activos"
              value={activos}
              icon={Users}
              description={`${perfiles.length} en total`}
            />
            <KPICard
              title="Ventas atribuidas"
              value={totales.ventas}
              icon={ShoppingCart}
              description={`en ${PERIOD_LABELS[periodPreset].toLowerCase()}`}
            />
            <KPICard
              title="Facturación (cash)"
              value={formatCurrency(totales.cash)}
              icon={Wallet}
              description={`${formatCurrency(totales.gross)} en ventas activas`}
            />
            <KPICard
              title="Comisiones del ledger"
              value={formatCurrency(totales.comisiones)}
              icon={Percent}
              description="motor de comisiones, no estimación"
            />
          </div>

          {/* §45 Listado con KPIs por colaborador */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-foreground">Listado de colaboradores</h2>
              <span className="text-xs text-muted-foreground">{lista.length} perfiles</span>
            </div>
            {lista.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {perfiles.length === 0
                  ? 'Aún no hay colaboradores de alta. Crea el primero desde Configuración → Programa de colaboradores o vía el alta API.'
                  : 'Ningún colaborador coincide con los filtros.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b border-border">
                      <th className="px-4 py-2 font-medium">Colaborador</th>
                      <th className="px-4 py-2 font-medium">Código</th>
                      <th className="px-4 py-2 font-medium">Estado</th>
                      <th className="px-4 py-2 font-medium text-right">Contactos</th>
                      <th className="px-4 py-2 font-medium text-right">Ventas</th>
                      <th className="px-4 py-2 font-medium text-right">Facturación</th>
                      <th className="px-4 py-2 font-medium text-right">Cash</th>
                      <th className="px-4 py-2 font-medium text-right">Comisiones</th>
                      <th className="px-4 py-2 font-medium text-right">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lista.map(({ perfil, kpi }) => (
                      <tr
                        key={perfil.id}
                        className="hover:bg-muted/40 cursor-pointer"
                        onClick={() => setDetalleId(perfil.id)}
                      >
                        <td className="px-4 py-2">
                          <div className="text-foreground">{filaDeUser(perfil)?.full_name ?? perfil.name ?? '—'}</div>
                          <div className="text-xs text-muted-foreground">{filaDeUser(perfil)?.email ?? ''}</div>
                        </td>
                        <td
                          className="px-4 py-2 font-mono text-xs text-muted-foreground"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-1.5">
                            <span>{perfil.code ?? '—'}</span>
                            {perfil.code && puedeGestionar && (
                              <button
                                type="button"
                                title={`Copiar enlace de referido con ?ref=${perfil.code}`}
                                onClick={() => copiarEnlace(perfil)}
                                className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                              >
                                {copiadoId === perfil.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                          {puedeGestionar ? (
                            <select
                              value={perfil.status ?? 'invited'}
                              disabled={guardandoEstado === perfil.id}
                              onChange={(e) => cambiarEstado(perfil, e.target.value)}
                              className="bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-brand-500"
                            >
                              {(['invited', 'pending_contract', 'active', 'suspended', 'inactive'] as const).map(
                                (s) => (
                                  <option key={s} value={s}>
                                    {ESTADO_LABELS[s]}
                                  </option>
                                )
                              )}
                            </select>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {ESTADO_LABELS[perfil.status ?? ''] ?? perfil.status ?? '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-foreground">{kpi.contactos}</td>
                        <td className="px-4 py-2 text-right text-foreground">{kpi.ventas}</td>
                        <td className="px-4 py-2 text-right text-foreground">{formatCurrency(kpi.gross)}</td>
                        <td className="px-4 py-2 text-right text-foreground">{formatCurrency(kpi.cash)}</td>
                        <td className="px-4 py-2 text-right text-emerald-400">{formatCurrency(kpi.comisiones)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {perfil.default_commission_percent != null
                            ? `${num(perfil.default_commission_percent)}%`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// --- §46 Detalle: KPIs del colaborador + enlaces a las vistas existentes ---
function FichaColaborador({
  tenant,
  perfil,
  kpi,
  comisiones,
  ventas,
  contactosPorPerfil,
  periodPreset,
  onVolver,
  onCopiar,
  copiado,
}: {
  tenant: string
  perfil: PerfilColaborador
  kpi: KpiColaborador
  comisiones: ComisionRow[]
  ventas: VentaRow[]
  contactosPorPerfil: Map<string, string[]>
  periodPreset: PeriodPreset
  onVolver: (() => void) | null
  onCopiar?: (perfil: PerfilColaborador) => void
  copiado?: boolean
}) {
  const [contactos, setContactos] = useState<ContactoRow[]>([])

  const contactIds = useMemo(
    () => (contactosPorPerfil.get(perfil.id) ?? []).slice(0, 200),
    [contactosPorPerfil, perfil.id]
  )

  useEffect(() => {
    let vivo = true
    ;(async () => {
      if (contactIds.length === 0) {
        setContactos([])
        return
      }
      const sb = createClient()
      const { data } = await sb
        .from('contacts')
        .select('id, full_name, lead_status, created_at')
        .in('id', contactIds)
        .order('created_at', { ascending: false })
        .limit(200)
      if (vivo) setContactos((data ?? []) as ContactoRow[])
    })()
    return () => {
      vivo = false
    }
  }, [contactIds])

  const nombreDe = useMemo(() => new Map(contactos.map((c) => [c.id, c.full_name || 'Contacto'])), [contactos])
  const idsContacto = useMemo(() => new Set(contactosPorPerfil.get(perfil.id) ?? []), [contactosPorPerfil, perfil.id])

  const ventasDelColaborador = useMemo(
    () =>
      ventas
        .filter((v) => v.contact_id && idsContacto.has(v.contact_id) && isActiveSale({ status: v.status ?? '' }))
        .slice()
        .sort((a, b) => ((a.sale_date ?? '') < (b.sale_date ?? '') ? 1 : -1))
        .slice(0, 25),
    [ventas, idsContacto]
  )

  const comisionesDelColaborador = useMemo(
    () =>
      comisiones
        .filter((c) => c.status !== 'cancelled')
        .slice()
        .sort((a, b) => ((a.created_at ?? '') < (b.created_at ?? '') ? 1 : -1))
        .slice(0, 15),
    [comisiones]
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {onVolver && (
            <button
              type="button"
              onClick={onVolver}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Volver al listado
            </button>
          )}
          <h2 className="text-lg font-semibold text-foreground">
            {filaDeUser(perfil)?.full_name ?? perfil.name ?? 'Colaborador'}
            <span className="ml-2 font-mono text-xs text-muted-foreground">{perfil.code ?? '—'}</span>
            {perfil.code && onCopiar && (
              <button
                type="button"
                title={`Copiar enlace de referido con ?ref=${perfil.code}`}
                onClick={() => onCopiar(perfil)}
                className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
              >
                {copiado ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            )}
          </h2>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <Link href={`/${tenant}/comisiones`} className="text-brand-400 hover:underline underline-offset-4">
            Ver ledger en Comisiones
          </Link>
          <Link
            href={`/${tenant}/marketing/adquisicion/atribucion`}
            className="text-brand-400 hover:underline underline-offset-4"
          >
            Ver origen en Atribución
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Contactos atribuidos"
          value={kpi.contactos}
          icon={Users}
          description="atribución estructurada total"
        />
        <KPICard
          title="Ventas activas"
          value={kpi.ventas}
          icon={ShoppingCart}
          description={`en ${PERIOD_LABELS[periodPreset].toLowerCase()}`}
        />
        <KPICard
          title="Facturación (cash)"
          value={formatCurrency(kpi.cash)}
          icon={Wallet}
          description="cobros collected del periodo"
        />
        <KPICard
          title="Comisiones"
          value={formatCurrency(kpi.comisiones)}
          icon={Percent}
          description={`% por defecto: ${perfil.default_commission_percent != null ? `${num(perfil.default_commission_percent)}%` : '—'}`}
        />
      </div>

      {/* Ventas ENLAZADAS a la vista existente de registro de ventas + ficha del contacto */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Ventas de sus contactos</h3>
        </div>
        {ventasDelColaborador.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Sin ventas activas en su scope.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Contacto</th>
                <th className="px-4 py-2 font-medium text-right">Importe</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ventasDelColaborador.map((v) => (
                <tr key={v.id} className="hover:bg-muted/40">
                  <td className="px-4 py-2 text-foreground">{formatDate(v.sale_date)}</td>
                  <td className="px-4 py-2">
                    {v.contact_id ? (
                      <Link
                        href={`/${tenant}/crm/contactos/${v.contact_id}`}
                        className="text-brand-400 hover:underline"
                      >
                        {nombreDe.get(v.contact_id) ?? 'Ver contacto'}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-foreground">{formatCurrency(num(v.gross_amount))}</td>
                  <td className="px-4 py-2 text-right">
                    <Link
                      href={`/${tenant}/ventas/registro/${v.id}`}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Abrir venta →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Contactos ENLAZADOS al CRM (máx. 200 recientes del scope) */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Contactos atribuidos</h3>
        </div>
        {contactos.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Ningún contacto atribuido todavía (llegarán con ?ref={perfil.code ?? ''}).
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="px-4 py-2 font-medium">Nombre</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Alta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contactos.map((c) => (
                <tr key={c.id} className="hover:bg-muted/40">
                  <td className="px-4 py-2">
                    <Link href={`/${tenant}/crm/contactos/${c.id}`} className="text-brand-400 hover:underline">
                      {c.full_name || 'Sin nombre'}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{c.lead_status ?? '—'}</td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Últimas comisiones del LEDGER real (la vista completa vive en /comisiones) */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Últimas comisiones del ledger</h3>
          <Link href={`/${tenant}/comisiones`} className="text-xs text-brand-400 hover:underline">
            Ver todas →
          </Link>
        </div>
        {comisionesDelColaborador.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Sin comisiones generadas todavía.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="px-4 py-2 font-medium">Fecha</th>
                <th className="px-4 py-2 font-medium">Lane</th>
                <th className="px-4 py-2 font-medium text-right">%</th>
                <th className="px-4 py-2 font-medium text-right">Importe</th>
                <th className="px-4 py-2 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {comisionesDelColaborador.map((c) => (
                <tr key={c.id} className="hover:bg-muted/40">
                  <td className="px-4 py-2 text-foreground">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{c.participant_type ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {c.percent != null ? `${num(c.percent)}%` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-emerald-400">{formatCurrency(num(c.commission_amount))}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {COMISION_STATUS_LABELS[c.status ?? ''] ?? c.status ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
