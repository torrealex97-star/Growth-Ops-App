'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSesion } from '@/lib/tenant-context'
import { createClient } from '@/lib/supabase/client'
import { KPICard } from '@/components/os/DashboardKPICard'
import { TrendingUp, ShoppingCart, Wallet, Percent } from 'lucide-react'
import { ACTIVE_SALE_STATUSES } from '@/lib/analytics'
import { formatCurrency, formatDate } from '@/lib/utils'
import { isLeadership, type AppRole } from '@/lib/auth/permissions'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { getPeriodRange, inPeriod, PERIOD_LABELS, type PeriodPreset } from '@/lib/filters/period'

// --- Tipos ---
type UserRow = {
  id: string
  full_name: string
  affiliate_code: string | null
  default_affiliate_commission_percent: number | string | null
}
type AttributionRow = {
  contact_id: string
  utm_content_first: string | null
  utm_content_last: string | null
}
type SaleRow = {
  id: string
  contact_id: string | null
  gross_amount: number | string
  status: string
  sale_date: string | null
}
type CollectionRow = {
  sale_id: string
  gross_amount: number | string
  status: string
  collected_at: string | null
}

type RoleUser = { id: string; roles?: { key?: string } | null }

const num = (x: number | string | null | undefined) => Number(x ?? 0)
const isActiveSale = (s: { status: string }) => ACTIVE_SALE_STATUSES.includes(s.status)
const isCollected = (c: { status: string }) => c.status === 'collected'

const SALE_STATUS_LABELS: Record<string, string> = {
  active: 'Activa',
  partial_refund: 'Reembolso parcial',
  refunded: 'Reembolsada',
  cancelled: 'Cancelada',
}

function saleStatusBadge(status: string) {
  const isGood = ACTIVE_SALE_STATUSES.includes(status)
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full border ${
        isGood
          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
          : 'bg-zinc-500/20 text-muted-foreground border-border/30'
      }`}
    >
      {SALE_STATUS_LABELS[status] ?? status}
    </span>
  )
}

export default function AfiliadosPage() {
  const [loading, setLoading] = useState(true)
  // Sesión ya resuelta por el layout: evita repetir auth.getUser() + from('users') aquí.
  const sesion = useSesion()
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentRole, setCurrentRole] = useState<AppRole | ''>('')
  const [currentAffiliateCode, setCurrentAffiliateCode] = useState<string | null>(null)

  const [affiliates, setAffiliates] = useState<UserRow[]>([])
  const [attributions, setAttributions] = useState<AttributionRow[]>([])
  const [sales, setSales] = useState<SaleRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])

  const [selectedAffiliateId, setSelectedAffiliateId] = useState<string>('all')

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const range = useMemo(() => getPeriodRange(periodPreset, customFrom, customTo), [periodPreset, customFrom, customTo])
  const hasActiveFilters = periodPreset !== 'month' || selectedAffiliateId !== 'all'
  const clearFilters = () => {
    setPeriodPreset('month')
    setCustomFrom('')
    setCustomTo('')
    setSelectedAffiliateId('all')
  }

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      // DOS VIAJES DE RED MENOS, en serie: el layout ya trajo la sesión y la fila de `users` completa.
      if (!sesion || !mounted) return
      setCurrentUserId(sesion.userId)
      const meRow = sesion.user as { affiliate_code?: string | null; roles?: { key?: string } | null }
      const role = (meRow.roles?.key ?? '') as AppRole | ''
      setCurrentRole(role)
      setCurrentAffiliateCode(meRow.affiliate_code ?? null)

      const [affRes, attrRes, salesRes, collRes] = await Promise.all([
        supabase
          .from('users')
          .select('id, full_name, affiliate_code, default_affiliate_commission_percent, roles!inner(key)')
          .eq('roles.key', 'affiliate'),
        supabase.from('contact_attributions').select('contact_id, utm_content_first, utm_content_last'),
        supabase.from('sales').select('id, contact_id, gross_amount, status, sale_date'),
        supabase.from('collections').select('sale_id, gross_amount, status, collected_at'),
      ])

      if (!mounted) return
      setAffiliates((affRes.data as UserRow[] | null) || [])
      setAttributions((attrRes.data as AttributionRow[] | null) || [])
      setSales((salesRes.data as SaleRow[] | null) || [])
      setCollections((collRes.data as CollectionRow[] | null) || [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
    // `sesion` entra en las dependencias: sin ella, la carga se quedaría con el valor capturado en el
    // primer render. Está memorizada en el layout, así que no provoca bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion])

  const isAffiliateUser = currentRole === 'affiliate'
  const isLead = currentRole ? isLeadership(currentRole) : false

  // contact_id -> utm_content (first o last, lo que exista)
  const contactUtmMap = useMemo(() => {
    const map = new Map<string, { first: string | null; last: string | null }>()
    for (const a of attributions) {
      map.set(a.contact_id, { first: a.utm_content_first, last: a.utm_content_last })
    }
    return map
  }, [attributions])

  // Ventas atribuidas a cada affiliate_code
  const salesByAffiliateCode = useMemo(() => {
    const map = new Map<string, SaleRow[]>()
    for (const s of sales) {
      if (!s.contact_id) continue
      const utm = contactUtmMap.get(s.contact_id)
      if (!utm) continue
      const code = utm.first || utm.last
      const matchesFirst = utm.first
      const matchesLast = utm.last
      // Un sale pertenece al afiliado si first o last coincide con su código.
      // Recorremos todos los afiliados y comprobamos coincidencia exacta.
      for (const aff of affiliates) {
        if (!aff.affiliate_code) continue
        if (matchesFirst === aff.affiliate_code || matchesLast === aff.affiliate_code) {
          const arr = map.get(aff.affiliate_code) || []
          arr.push(s)
          map.set(aff.affiliate_code, arr)
        }
      }
      void code
    }
    return map
  }, [sales, contactUtmMap, affiliates])

  // Filtrado por periodo seleccionado (sobre sale_date, ventas activas)
  const statsForCode = useCallback(
    (code: string | null) => {
      if (!code) return { salesActive: [], count: 0, gross: 0, cash: 0 }
      const allSales = salesByAffiliateCode.get(code) || []
      const periodSales = allSales.filter((s) => isActiveSale(s) && inPeriod(s.sale_date, range))
      const saleIds = new Set(periodSales.map((s) => s.id))
      const gross = periodSales.reduce((acc, s) => acc + num(s.gross_amount), 0)
      const cash = collections
        .filter((c) => isCollected(c) && saleIds.has(c.sale_id) && inPeriod(c.collected_at, range))
        .reduce((acc, c) => acc + num(c.gross_amount), 0)
      return { salesActive: periodSales, count: periodSales.length, gross, cash }
    },
    [salesByAffiliateCode, collections, range]
  )

  // Ventas del afiliado dentro del periodo seleccionado — para la tabla de detalle
  const allSalesForCode = useCallback(
    (code: string | null) => {
      if (!code) return []
      return (salesByAffiliateCode.get(code) || [])
        .filter((s) => inPeriod(s.sale_date, range))
        .slice()
        .sort((a, b) => {
          const da = a.sale_date || ''
          const db = b.sale_date || ''
          return db.localeCompare(da)
        })
    },
    [salesByAffiliateCode, range]
  )

  const ranking = useMemo(() => {
    return affiliates
      .map((aff) => {
        const stats = statsForCode(aff.affiliate_code)
        const pct = num(aff.default_affiliate_commission_percent)
        const commission = stats.cash * (pct / 100)
        return {
          id: aff.id,
          name: aff.full_name,
          code: aff.affiliate_code || '—',
          pct,
          sales: stats.count,
          gross: stats.gross,
          cash: stats.cash,
          commission,
        }
      })
      .sort((a, b) => b.cash - a.cash)
  }, [affiliates, statsForCode])

  const totalRanking = useMemo(() => {
    return ranking.reduce(
      (acc, r) => ({
        sales: acc.sales + r.sales,
        cash: acc.cash + r.cash,
        commission: acc.commission + r.commission,
      }),
      { sales: 0, cash: 0, commission: 0 }
    )
  }, [ranking])

  // Afiliado activo para vista "afiliado" (yo mismo) o detalle en liderazgo
  const meAsAffiliate = useMemo(
    () => affiliates.find((a) => a.id === currentUserId) || null,
    [affiliates, currentUserId]
  )

  const selectedAffiliate = useMemo(() => {
    if (isAffiliateUser) return meAsAffiliate
    if (selectedAffiliateId === 'all') return null
    return affiliates.find((a) => a.id === selectedAffiliateId) || null
  }, [isAffiliateUser, meAsAffiliate, selectedAffiliateId, affiliates])

  const selectedCode = isAffiliateUser
    ? currentAffiliateCode || meAsAffiliate?.affiliate_code || null
    : selectedAffiliate?.affiliate_code || null

  const selectedStats = useMemo(() => statsForCode(selectedCode), [selectedCode, statsForCode])
  const selectedSalesList = useMemo(() => allSalesForCode(selectedCode), [selectedCode, allSalesForCode])

  const selectedCommission = useMemo(() => {
    const pct = num(
      isAffiliateUser
        ? meAsAffiliate?.default_affiliate_commission_percent
        : selectedAffiliate?.default_affiliate_commission_percent
    )
    return selectedStats.cash * (pct / 100)
  }, [selectedStats, isAffiliateUser, meAsAffiliate, selectedAffiliate])

  const hasAnyAttributedSales = useMemo(() => salesByAffiliateCode.size > 0, [salesByAffiliateCode])

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
            {isAffiliateUser ? 'Tu negocio como colaborador' : 'Ranking y detalle de colaboradores por código UTM'}
          </p>
        </div>
      </div>

      <PeriodFilterBar
        preset={periodPreset}
        onPresetChange={setPeriodPreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        {...(isLead
          ? {
              members: affiliates.map((a) => ({
                id: a.id,
                full_name: `${a.full_name}${a.affiliate_code ? ` (${a.affiliate_code})` : ''}`,
              })),
              member: selectedAffiliateId,
              onMemberChange: setSelectedAffiliateId,
              memberLabel: 'Colaborador',
              allMembersLabel: 'Todos los colaboradores',
            }
          : {})}
        onClear={clearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {!hasAnyAttributedSales && (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          Aún no hay ventas atribuidas a colaboradores (por utm_content / ?ref=).
        </div>
      )}

      {/* Vista afiliado: solo su negocio */}
      {isAffiliateUser && hasAnyAttributedSales && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <KPICard
              title="Mis ventas"
              value={selectedStats.count}
              icon={ShoppingCart}
              description={`código: ${currentAffiliateCode || meAsAffiliate?.affiliate_code || '—'}`}
            />
            <KPICard
              title="Mi facturación (cash)"
              value={formatCurrency(selectedStats.cash)}
              icon={Wallet}
              description="cash collected atribuido"
            />
            <KPICard
              title="Mi comisión estimada"
              value={formatCurrency(selectedCommission)}
              icon={Percent}
              description={`${num(meAsAffiliate?.default_affiliate_commission_percent)}% sobre facturación`}
            />
          </div>

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">Mis ventas atribuidas</h2>
            </div>
            {selectedSalesList.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Aún no hay ventas atribuidas a colaboradores (por utm_content / ?ref=).
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="px-4 py-2 font-medium">Fecha</th>
                    <th className="px-4 py-2 font-medium">Importe</th>
                    <th className="px-4 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selectedSalesList.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/40">
                      <td className="px-4 py-2 text-foreground">{formatDate(s.sale_date)}</td>
                      <td className="px-4 py-2 text-foreground">{formatCurrency(num(s.gross_amount))}</td>
                      <td className="px-4 py-2">{saleStatusBadge(s.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Vista liderazgo */}
      {isLead && hasAnyAttributedSales && (
        <>
          {selectedAffiliateId === 'all' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <KPICard
                  title="Ventas atribuidas"
                  value={totalRanking.sales}
                  icon={ShoppingCart}
                  description={`en ${PERIOD_LABELS[periodPreset].toLowerCase()}`}
                />
                <KPICard
                  title="Facturación (cash)"
                  value={formatCurrency(totalRanking.cash)}
                  icon={Wallet}
                  description="todos los afiliados"
                />
                <KPICard
                  title="Comisiones estimadas"
                  value={formatCurrency(totalRanking.commission)}
                  icon={Percent}
                  description="a liquidar"
                />
              </div>

              <div className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h2 className="text-sm font-semibold text-foreground">
                    Ranking de colaboradores — {PERIOD_LABELS[periodPreset]}
                  </h2>
                </div>
                {ranking.every((r) => r.sales === 0) ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Aún no hay ventas atribuidas a colaboradores (por utm_content / ?ref=).
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground border-b border-border">
                        <th className="px-4 py-2 font-medium">Afiliado</th>
                        <th className="px-4 py-2 font-medium">Código</th>
                        <th className="px-4 py-2 font-medium">Ventas</th>
                        <th className="px-4 py-2 font-medium">Facturación</th>
                        <th className="px-4 py-2 font-medium">Comisión</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {ranking.map((r) => (
                        <tr
                          key={r.id}
                          className="hover:bg-muted/40 cursor-pointer"
                          onClick={() => setSelectedAffiliateId(r.id)}
                        >
                          <td className="px-4 py-2 text-foreground">{r.name}</td>
                          <td className="px-4 py-2 text-muted-foreground">{r.code}</td>
                          <td className="px-4 py-2 text-foreground">{r.sales}</td>
                          <td className="px-4 py-2 text-foreground">{formatCurrency(r.cash)}</td>
                          <td className="px-4 py-2 text-emerald-400">{formatCurrency(r.commission)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            selectedAffiliate && (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-foreground">
                    {selectedAffiliate.full_name}{' '}
                    <span className="text-muted-foreground text-sm font-normal">
                      ({selectedAffiliate.affiliate_code || '—'})
                    </span>
                  </h2>
                  <button
                    type="button"
                    onClick={() => setSelectedAffiliateId('all')}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    ← Volver al ranking
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <KPICard
                    title="Ventas"
                    value={selectedStats.count}
                    icon={ShoppingCart}
                    description={`en ${PERIOD_LABELS[periodPreset].toLowerCase()}`}
                  />
                  <KPICard
                    title="Facturación (cash)"
                    value={formatCurrency(selectedStats.cash)}
                    icon={Wallet}
                    description="cash collected atribuido"
                  />
                  <KPICard
                    title="Comisión estimada"
                    value={formatCurrency(selectedCommission)}
                    icon={Percent}
                    description={`${num(selectedAffiliate.default_affiliate_commission_percent)}% sobre facturación`}
                  />
                </div>

                <div className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <h2 className="text-sm font-semibold text-foreground">Ventas atribuidas</h2>
                  </div>
                  {selectedSalesList.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      Aún no hay ventas atribuidas a colaboradores (por utm_content / ?ref=).
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground border-b border-border">
                          <th className="px-4 py-2 font-medium">Fecha</th>
                          <th className="px-4 py-2 font-medium">Importe</th>
                          <th className="px-4 py-2 font-medium">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selectedSalesList.map((s) => (
                          <tr key={s.id} className="hover:bg-muted/40">
                            <td className="px-4 py-2 text-foreground">{formatDate(s.sale_date)}</td>
                            <td className="px-4 py-2 text-foreground">{formatCurrency(num(s.gross_amount))}</td>
                            <td className="px-4 py-2">{saleStatusBadge(s.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )
          )}
        </>
      )}

      {/* Ni afiliado ni liderazgo: sin acceso a datos */}
      {!isAffiliateUser && !isLead && (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          No tienes permisos para ver este panel.
        </div>
      )}
    </div>
  )
}
