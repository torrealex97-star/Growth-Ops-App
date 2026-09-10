'use client'

import { useState } from 'react'
import type { UTMStats } from '@/lib/types'
import { DonutChart } from './FuenteChart'
import { scoreColor, truncate } from '@/lib/utils'

interface UTMAnalysisProps {
  utmStats: UTMStats | null
  loading?: boolean
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex gap-4">
          <div className="skeleton h-10 flex-1 rounded-xl" />
        </div>
      ))}
    </div>
  )
}

export function UTMAnalysis({ utmStats, loading = false }: UTMAnalysisProps) {
  const [sortField, setSortField] = useState<'totalLeads' | 'encuestaPct'>('totalLeads')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function handleSort(field: 'totalLeads' | 'encuestaPct') {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const sortedCampaigns = utmStats?.byCampaign
    ? [...utmStats.byCampaign].sort((a, b) => {
        const aVal = a[sortField]
        const bVal = b[sortField]
        return sortDir === 'desc' ? bVal - aVal : aVal - bVal
      })
    : []

  const topAd = utmStats?.byAd?.[0]
  const topCampaign = utmStats?.byCampaign?.[0]

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
        <h2 className="text-lg font-bold text-foreground">Fuentes y Anuncios</h2>
      </div>

      {/* Anuncio ganador highlight */}
      {topAd && !loading && (
        <div className="bg-[#1a1a2e] border border-[#C9477A]/30 rounded-2xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#C9477A]/10 border border-[#C9477A]/20 flex items-center justify-center flex-shrink-0 text-lg">
            🏆
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-[#C9477A] font-medium mb-0.5">Anuncio ganador (utm_term)</p>
            <p className="text-foreground font-bold truncate">{topAd.label}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-2xl font-bold text-foreground">{topAd.count}</p>
            <p className="text-xs text-[#4a4a6a]">{topAd.pct}% de leads</p>
          </div>
        </div>
      )}

      {/* Two-column: donut + top ads */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* UTM Source donut */}
        <div className="lg:col-span-1">
          <DonutChart
            title="UTM Source"
            data={utmStats?.bySource || []}
            loading={loading}
          />
        </div>

        {/* Top anuncios (utm_term) */}
        <div className="lg:col-span-2 bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6">
          <h3 className="text-foreground font-semibold mb-4">Ranking de Anuncios <span className="text-xs text-[#4a4a6a] font-normal ml-1">utm_term = ad.name</span></h3>
          {loading ? (
            <TableSkeleton />
          ) : (utmStats?.byAd || []).length === 0 ? (
            <p className="text-[#94a3b8] text-sm">Sin datos de utm_term todavía</p>
          ) : (
            <div className="space-y-2">
              {utmStats!.byAd.slice(0, 8).map((ad, idx) => (
                <div key={ad.label} className="flex items-center gap-3">
                  <span className="text-xs text-[#4a4a6a] w-5 text-right flex-shrink-0">
                    {idx === 0 ? <span className="text-[#C9477A]">★</span> : idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-foreground truncate pr-2" title={ad.label}>{ad.label}</span>
                      <span className="text-sm font-bold text-foreground flex-shrink-0">{ad.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#2a2a3e] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${ad.pct}%`,
                          background: idx === 0 ? '#C9477A' : '#3a3a6e',
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-[#4a4a6a] w-10 text-right flex-shrink-0">{ad.pct}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabla detallada: campaña + adset + anuncio */}
      <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-foreground font-semibold">Desglose completo por Anuncio</h3>
          {topCampaign && !loading && (
            <span className="text-xs bg-[#C9477A]/20 text-[#C9477A] border border-[#C9477A]/30 px-2 py-1 rounded-full">
              Top campaña: {truncate(topCampaign.campaign, 20)}
            </span>
          )}
        </div>

        {loading ? (
          <TableSkeleton />
        ) : sortedCampaigns.length === 0 ? (
          <p className="text-[#94a3b8] text-sm">Sin datos de campañas UTM</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[#94a3b8] border-b border-[#2a2a3e]">
                  <th className="text-left pb-3 font-medium w-5">#</th>
                  <th className="text-left pb-3 font-medium">Campaña</th>
                  <th className="text-left pb-3 font-medium">AdSet (utm_content)</th>
                  <th className="text-left pb-3 font-medium text-[#C9477A]">Anuncio (utm_term)</th>
                  <th
                    className="text-right pb-3 font-medium cursor-pointer hover:text-foreground transition-colors select-none"
                    onClick={() => handleSort('totalLeads')}
                  >
                    Leads {sortField === 'totalLeads' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th
                    className="text-right pb-3 font-medium cursor-pointer hover:text-foreground transition-colors select-none"
                    onClick={() => handleSort('encuestaPct')}
                  >
                    Encuesta % {sortField === 'encuestaPct' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                  </th>
                  <th className="text-right pb-3 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {sortedCampaigns.map((row, idx) => (
                  <tr
                    key={`${row.campaign}-${row.content}-${row.term}-${idx}`}
                    className="border-b border-[#2a2a3e]/50 hover:bg-[#222238] transition-colors"
                  >
                    <td className="py-3 text-[#4a4a6a] text-xs pr-2">
                      {idx === 0 && sortField === 'totalLeads' && sortDir === 'desc' ? (
                        <span className="text-[#C9477A]">★</span>
                      ) : (
                        idx + 1
                      )}
                    </td>
                    <td className="py-3">
                      <span className="text-foreground font-medium" title={row.campaign}>
                        {truncate(row.campaign === '—' ? 'Sin campaña' : row.campaign, 22)}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="text-[#94a3b8]" title={row.content}>
                        {truncate(row.content === '—' ? '—' : row.content, 18)}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="text-[#C9477A] font-medium" title={row.term}>
                        {truncate(row.term === '—' ? '—' : row.term, 20)}
                      </span>
                    </td>
                    <td className="py-3 text-right text-foreground font-semibold">
                      {row.totalLeads}
                    </td>
                    <td className="py-3 text-right text-[#94a3b8]">
                      {row.encuestaCount}/{row.totalLeads}
                    </td>
                    <td className="py-3 text-right">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${scoreColor(row.score)}`}
                      >
                        {row.score}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
