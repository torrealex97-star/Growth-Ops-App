'use client'

import { useState, useMemo } from 'react'
import type { Lead } from '@/lib/types'
import { formatDate, truncate } from '@/lib/utils'

interface LeadsTableProps {
  leads: Lead[]
  loading?: boolean
}

const PAGE_SIZE = 20

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton h-12 rounded-xl" />
      ))}
    </div>
  )
}

export function LeadsTable({ leads, loading = false }: LeadsTableProps) {
  const [search, setSearch] = useState('')
  const [filterFuente, setFilterFuente] = useState('')
  const [filterEncuesta, setFilterEncuesta] = useState<'' | 'si' | 'no'>('')
  const [filterWA, setFilterWA] = useState<'' | 'enviado' | 'timeout' | 'fallido' | 'pendiente'>('')
  const [page, setPage] = useState(1)

  // Unique UTM sources for filter
  const fuentes = useMemo(() => {
    const set = new Set<string>()
    leads.forEach((l) => set.add(l.utmSource?.trim() || 'Directo'))
    return Array.from(set).sort()
  }, [leads])

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const q = search.toLowerCase()
      const matchSearch =
        !q ||
        l.nombre.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.telefono.includes(q)

      const leadFuente = l.utmSource?.trim() || 'Directo'
      const matchFuente = !filterFuente || leadFuente === filterFuente

      const matchEncuesta =
        !filterEncuesta ||
        (filterEncuesta === 'si' && l.encuestaRellenada) ||
        (filterEncuesta === 'no' && !l.encuestaRellenada)

      const wa = l.whatsappRegistro?.toLowerCase() || ''
      const matchWA =
        !filterWA ||
        (filterWA === 'enviado' && wa === 'enviado') ||
        (filterWA === 'timeout' && wa === 'timeout') ||
        (filterWA === 'fallido' && wa === 'fallido') ||
        (filterWA === 'pendiente' && wa !== 'enviado' && wa !== 'timeout' && wa !== 'fallido')

      return matchSearch && matchFuente && matchEncuesta && matchWA
    })
  }, [leads, search, filterFuente, filterEncuesta, filterWA])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleSearch(val: string) {
    setSearch(val)
    setPage(1)
  }

  function handleFilterFuente(val: string) {
    setFilterFuente(val)
    setPage(1)
  }

  function handleFilterEncuesta(val: '' | 'si' | 'no') {
    setFilterEncuesta(val)
    setPage(1)
  }

  function handleFilterWA(val: '' | 'enviado' | 'timeout' | 'fallido' | 'pendiente') {
    setFilterWA(val)
    setPage(1)
  }

  return (
    <section>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
        <h2 className="text-lg font-bold text-foreground">Todos los Leads</h2>
        <span className="text-xs text-[#94a3b8] bg-[#1a1a2e] border border-[#2a2a3e] px-2 py-0.5 rounded-full">
          {filtered.length} resultados
        </span>
      </div>

      <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-6">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-5">
          <input
            type="text"
            placeholder="Buscar por nombre, email o telefono..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-foreground placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A] transition-colors"
          />

          <select
            value={filterFuente}
            onChange={(e) => handleFilterFuente(e.target.value)}
            className="px-3 py-2 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-sm text-[#94a3b8] focus:outline-none focus:border-[#C9477A] transition-colors"
          >
            <option value="">Todas las fuentes</option>
            {fuentes.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>

          <select
            value={filterEncuesta}
            onChange={(e) => handleFilterEncuesta(e.target.value as '' | 'si' | 'no')}
            className="px-3 py-2 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-sm text-[#94a3b8] focus:outline-none focus:border-[#C9477A] transition-colors"
          >
            <option value="">Encuesta: todas</option>
            <option value="si">Completada</option>
            <option value="no">Pendiente</option>
          </select>

          <select
            value={filterWA}
            onChange={(e) => handleFilterWA(e.target.value as '' | 'enviado' | 'timeout' | 'fallido' | 'pendiente')}
            className="px-3 py-2 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-sm text-[#94a3b8] focus:outline-none focus:border-[#C9477A] transition-colors"
          >
            <option value="">WA: todos</option>
            <option value="enviado">Enviado</option>
            <option value="timeout">Timeout</option>
            <option value="fallido">Fallido</option>
            <option value="pendiente">Sin contactar</option>
          </select>

          {(search || filterFuente || filterEncuesta || filterWA) && (
            <button
              onClick={() => {
                setSearch('')
                setFilterFuente('')
                setFilterEncuesta('')
                setFilterWA('')
                setPage(1)
              }}
              className="px-3 py-2 bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#94a3b8] rounded-xl text-sm transition-colors"
            >
              Limpiar
            </button>
          )}
        </div>

        {loading ? (
          <TableSkeleton />
        ) : paginated.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#94a3b8]">No hay leads que coincidan con los filtros.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[#94a3b8] border-b border-[#2a2a3e] text-left">
                    <th className="pb-3 font-medium pr-4">Fecha</th>
                    <th className="pb-3 font-medium pr-4">Nombre</th>
                    <th className="pb-3 font-medium pr-4">Email</th>
                    <th className="pb-3 font-medium pr-4">UTM Source</th>
                    <th className="pb-3 font-medium pr-4">Campaña</th>
                    <th className="pb-3 font-medium pr-4">WA Registro</th>
                    <th className="pb-3 font-medium pr-4">Encuesta</th>
                    <th className="pb-3 font-medium pr-4">Edad</th>
                    <th className="pb-3 font-medium">Fuente (encuesta)</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((lead, idx) => (
                    <tr
                      key={lead.id || lead.email || idx}
                      className="border-b border-[#2a2a3e]/40 hover:bg-[#222238] transition-colors"
                    >
                      <td className="py-3 pr-4 text-[#94a3b8] whitespace-nowrap text-xs">
                        {formatDate(lead.fechaRegistro)}
                      </td>
                      <td className="py-3 pr-4 text-foreground font-medium whitespace-nowrap">
                        {truncate(lead.nombre || '—', 22)}
                      </td>
                      <td className="py-3 pr-4 text-[#94a3b8]">
                        <span title={lead.email}>
                          {truncate(lead.email || '—', 28)}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-xs bg-[#2a2a3e] text-[#94a3b8] px-2 py-0.5 rounded-full whitespace-nowrap">
                          {lead.utmSource?.trim() || 'Directo'}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-[#94a3b8] text-xs">
                        <span title={lead.utmCampaign}>
                          {truncate(lead.utmCampaign?.trim() || '—', 18)}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        {lead.whatsappRegistro === 'enviado' ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-[#25d366]/15 text-[#25d366] border border-[#25d366]/25 px-2 py-0.5 rounded-full whitespace-nowrap">
                            <span className="w-1.5 h-1.5 bg-[#25d366] rounded-full" />
                            Enviado
                          </span>
                        ) : lead.whatsappRegistro === 'timeout' ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-orange-500/15 text-orange-400 border border-orange-500/25 px-2 py-0.5 rounded-full whitespace-nowrap">
                            <span className="w-1.5 h-1.5 bg-orange-400 rounded-full" />
                            Timeout
                          </span>
                        ) : lead.whatsappRegistro === 'fallido' ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-red-500/15 text-red-400 border border-red-500/25 px-2 py-0.5 rounded-full whitespace-nowrap">
                            <span className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                            Fallido
                          </span>
                        ) : (
                          <span className="text-xs text-[#4a4a6a]">—</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {lead.encuestaRellenada ? (
                          <span className="inline-flex items-center gap-1 text-xs bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 px-2 py-0.5 rounded-full whitespace-nowrap">
                            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                            Completada
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs bg-[#2a2a3e] text-[#94a3b8] border border-[#3a3a5e] px-2 py-0.5 rounded-full whitespace-nowrap">
                            <span className="w-1.5 h-1.5 bg-[#4a4a6a] rounded-full" />
                            Pendiente
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-[#94a3b8] text-xs whitespace-nowrap">
                        {lead.q0Edad || '—'}
                      </td>
                      <td className="py-3 text-[#94a3b8] text-xs">
                        <span title={lead.q1Fuente}>
                          {truncate(lead.q1Fuente || '—', 24)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-5 pt-4 border-t border-[#2a2a3e]">
                <span className="text-xs text-[#94a3b8]">
                  Pagina {page} de {totalPages} ({filtered.length} leads)
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="px-3 py-1.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] disabled:opacity-40 disabled:cursor-not-allowed text-foreground text-xs rounded-lg transition-colors"
                  >
                    Anterior
                  </button>

                  {/* Page numbers */}
                  <div className="flex gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number
                      if (totalPages <= 5) {
                        pageNum = i + 1
                      } else if (page <= 3) {
                        pageNum = i + 1
                      } else if (page >= totalPages - 2) {
                        pageNum = totalPages - 4 + i
                      } else {
                        pageNum = page - 2 + i
                      }
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setPage(pageNum)}
                          className={`w-8 h-7 text-xs rounded-lg transition-colors ${
                            pageNum === page
                              ? 'bg-[#C9477A] text-foreground'
                              : 'bg-[#2a2a3e] text-[#94a3b8] hover:bg-[#3a3a5e]'
                          }`}
                        >
                          {pageNum}
                        </button>
                      )
                    })}
                  </div>

                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                    className="px-3 py-1.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] disabled:opacity-40 disabled:cursor-not-allowed text-foreground text-xs rounded-lg transition-colors"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
