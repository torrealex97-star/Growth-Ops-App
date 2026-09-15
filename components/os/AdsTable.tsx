'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import type { Campaign, CampaignAd } from '@/lib/types/database'
import { Megaphone, X } from 'lucide-react'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import { Button } from '@/components/ui/button'

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null)

const statusBadge = (s: string | null) => {
  if (s === 'activa') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
  if (s === 'pausada') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  return 'bg-muted/30 text-muted-foreground border-border/30'
}

type Props = {
  campaigns: Campaign[]
  accounts: { id: string; name: string }[]
  version: number // se incrementa tras sincronizar anuncios → refetch
}

// Vista a nivel de ANUNCIO: drill-down de las campañas de Meta. Permite filtrar por
// cuenta, por campaña y buscar por nombre. Muestra gasto, leads, seguidores y coste
// por seguidor de cada anuncio.
export function AdsTable({ campaigns, accounts, version }: Props) {
  const [ads, setAds] = useState<CampaignAd[]>([])
  const [loading, setLoading] = useState(true)
  const [accountFilter, setAccountFilter] = useState('all')
  const [campaignFilter, setCampaignFilter] = useState('all')
  const [search, setSearch] = useState('')

  // Nombre de campaña por id (para el desplegable y la columna).
  const campaignNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of campaigns) m.set(c.id, c.name)
    return m
  }, [campaigns])

  useEffect(() => {
    let cancel = false
    setLoading(true)
    const supabase = createClient()
    supabase
      .from('campaign_ads')
      .select('*')
      .order('spend', { ascending: false })
      .then(({ data }) => {
        if (!cancel) {
          setAds((data as CampaignAd[]) || [])
          setLoading(false)
        }
      })
    return () => {
      cancel = true
    }
  }, [version])

  // Campañas presentes en los anuncios (para el desplegable de filtro por campaña).
  const campaignOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const a of ads) {
      if (a.campaign_id && (accountFilter === 'all' || a.account_id === accountFilter)) ids.add(a.campaign_id)
    }
    return Array.from(ids)
      .map((id) => ({ id, name: campaignNameById.get(id) || '(campaña)' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [ads, campaignNameById, accountFilter])

  const filtered = useMemo(() => {
    const q = normalizeText(search.trim())
    return ads.filter(
      (a) =>
        (accountFilter === 'all' || a.account_id === accountFilter) &&
        (campaignFilter === 'all' || a.campaign_id === campaignFilter) &&
        (q === '' || normalizeText(a.name).includes(q) || normalizeText(a.adset_name || '').includes(q))
    )
  }, [ads, accountFilter, campaignFilter, search])

  const totalSpend = filtered.reduce((s, a) => s + (a.spend || 0), 0)
  const totalLeads = filtered.reduce((s, a) => s + (a.leads || 0), 0)
  const totalFollowers = filtered.reduce((s, a) => s + (a.followers || 0), 0)
  const costPerFollower = div(totalSpend, totalFollowers)

  if (loading) return <div className="h-64 bg-card rounded-lg animate-pulse" />

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        {accounts.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Cuenta</span>
            <select
              value={accountFilter}
              onChange={(e) => {
                setAccountFilter(e.target.value)
                setCampaignFilter('all')
              }}
              className="text-sm rounded-lg border border-border bg-muted px-3 py-2 text-foreground focus:outline-none focus:border-brand-500"
            >
              <option value="all">Todas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Campaña</span>
          <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            className="text-sm rounded-lg border border-border bg-muted px-3 py-2 text-foreground focus:outline-none focus:border-brand-500 max-w-xs"
          >
            <option value="all">Todas ({campaignOptions.length})</option>
            {campaignOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Buscar anuncio o conjunto…"
          className="flex-1 min-w-[200px]"
        />
        {(accountFilter !== 'all' || campaignFilter !== 'all' || search.trim()) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAccountFilter('all')
              setCampaignFilter('all')
              setSearch('')
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" /> Limpiar filtros
          </Button>
        )}
      </div>

      {/* Una superficie con divisores en vez de 4 cards idénticas — mismo patrón que la
          cabecera de Campañas, para no repetir "grid de KPI cards" en cada pantalla. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border rounded-lg border border-border bg-card/30">
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Anuncios</p>
          <p className="mt-1 text-xl font-semibold text-foreground tabular-nums">{formatNumber(filtered.length)}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Gasto</p>
          <p className="mt-1 text-xl font-semibold text-foreground tabular-nums">{formatCurrency(totalSpend)}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Seguidores</p>
          <p className="mt-1 text-xl font-semibold text-foreground tabular-nums">{formatNumber(totalFollowers)}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">€ / Seguidor</p>
          <p className="mt-1 text-xl font-semibold text-foreground tabular-nums">
            {costPerFollower === null ? '—' : formatCurrency(costPerFollower)}
          </p>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-card/50 border border-border rounded-lg p-10 text-center">
          <Megaphone className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">
            {ads.length === 0
              ? 'Aún no hay anuncios. Pulsa «Sincronizar anuncios» para traerlos desde Meta.'
              : 'Ningún anuncio coincide con los filtros.'}
          </p>
        </div>
      ) : (
        <div className="bg-card/50 border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 z-10 bg-card border-b border-border text-left text-muted-foreground text-xs uppercase">
                <th className="px-4 py-3">Anuncio</th>
                <th className="px-4 py-3">Campaña</th>
                {accounts.length > 1 && <th className="px-4 py-3">Cuenta</th>}
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Gasto</th>
                <th className="px-4 py-3 text-right">Leads</th>
                <th className="px-4 py-3 text-right">Seguidores</th>
                <th className="px-4 py-3 text-right">€/Seg</th>
                <th className="px-4 py-3 text-right">CPC</th>
                <th className="px-4 py-3 text-right">CTR</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const cpc = div(a.spend, a.clicks)
                const ctr = div(a.clicks, a.impressions)
                const cpf = div(a.spend, a.followers || 0)
                return (
                  <tr key={a.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 text-foreground max-w-[280px]">
                      <div className="truncate" title={a.name}>
                        {a.name}
                      </div>
                      {a.adset_name && (
                        <div className="text-[11px] text-muted-foreground truncate" title={a.adset_name}>
                          {a.adset_name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                      <span className="truncate block" title={a.campaign_id ? campaignNameById.get(a.campaign_id) : ''}>
                        {a.campaign_id ? campaignNameById.get(a.campaign_id) || '—' : '—'}
                      </span>
                    </td>
                    {accounts.length > 1 && (
                      <td className="px-4 py-3 text-[11px] text-muted-foreground">
                        {a.account_name || a.account_id || '—'}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded border ${statusBadge(a.status)}`}>
                        {a.status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">
                      {formatCurrency(a.spend || 0)}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">{formatNumber(a.leads || 0)}</td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">
                      {(a.followers || 0) > 0 ? formatNumber(a.followers || 0) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                      {cpf === null ? '—' : formatCurrency(cpf)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                      {cpc === null ? '—' : formatCurrency(cpc)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                      {formatPercent(ctr === null ? null : ctr * 100, 2)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
