'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Lead } from '@/lib/types'

type CCLead = Lead & { ccEstado: string | null; ccNotas: string | null; ccUpdatedAt: string | null }
type LaunchStats = { reuniones: number; ventas: number; cash_collected: number; comision: number }

function fmt(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

const ESTADOS = [
  { value: 'llamada_asiste', label: 'Llamada Asiste', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/25' },
  { value: 'llamada_no_asiste', label: 'Llamada No Asiste', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/25' },
  { value: 'no_contesta', label: 'No Contesta', color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/25' },
  { value: 'no_existe', label: 'No Existe', color: 'text-[#4a4a6a]', bg: 'bg-[#2a2a3e] border-[#3a3a5e]' },
  { value: 'llamar_mas_tarde', label: 'Llamar Más Tarde', color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/25' },
  { value: 'alumna_bw', label: 'Alumna BW', color: 'text-purple-400', bg: 'bg-purple-500/15 border-purple-500/25' },
]

function estadoMeta(val: string | null) {
  return ESTADOS.find((e) => e.value === val) ?? null
}

function formatPhone(raw: string): { display: string; tel: string } {
  if (!raw?.trim() || raw.startsWith('#')) return { display: '—', tel: '' }
  const digits = raw.replace(/\D/g, '')
  if (!digits) return { display: '—', tel: '' }
  let tel = ''
  if (digits.startsWith('0034') && digits.length >= 13) {
    tel = `+34${digits.slice(4)}`
  } else if (digits.startsWith('34') && digits.length === 11) {
    tel = `+${digits}`
  } else if (digits.length === 9 && /^[67689]/.test(digits)) {
    tel = `+34${digits}`
  } else {
    tel = `+34${digits}`
  }
  const num = tel.replace('+34', '').replace(/\D/g, '')
  const display = num.length === 9
    ? `+34 ${num.slice(0, 3)} ${num.slice(3, 6)} ${num.slice(6)}`
    : tel
  return { display, tel }
}

export default function ColdCallingPanel() {
  const router = useRouter()
  const [leads, setLeads] = useState<CCLead[]>([])
  const [caller, setCaller] = useState<{ nombre: string; id: number } | null>(null)
  const [launchStats, setLaunchStats] = useState<LaunchStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [fetchError, setFetchError] = useState('')
  const [activeLead, setActiveLead] = useState<CCLead | null>(null)
  const [modalEstado, setModalEstado] = useState('')
  const [modalNotas, setModalNotas] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const prevCountRef = useRef(0)

  const fetchLeads = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    setFetchError('')
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15_000)
      const res = await fetch('/api/coldcalling/leads', { signal: controller.signal })
      clearTimeout(timeout)

      if (res.status === 401) {
        router.push('/coldcalling/login')
        return
      }
      if (!res.ok) throw new Error(`Error ${res.status}`)

      const data = await res.json()
      setLeads(data.leads || [])
      setCaller(data.caller || null)
      setLaunchStats(data.launchStats || null)

      if (prevCountRef.current > 0 && data.leads?.length > prevCountRef.current) {
        const newCount = data.leads.length - prevCountRef.current
        setSaveMsg(`¡${newCount} lead${newCount > 1 ? 's' : ''} nuevo${newCount > 1 ? 's' : ''} asignado${newCount > 1 ? 's' : ''}!`)
        setTimeout(() => setSaveMsg(''), 5000)
      }
      prevCountRef.current = data.leads?.length ?? 0
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setFetchError('Error al cargar leads. Comprueba tu conexión.')
      } else {
        setFetchError('Tiempo de espera agotado. Inténtalo de nuevo.')
      }
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { fetchLeads(true) }, [fetchLeads])

  // Auto-refresh every 15s (only when tab is visible)
  useEffect(() => {
    const tick = () => { if (!document.hidden) fetchLeads(false) }
    const interval = setInterval(tick, 15_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', tick) }
  }, [fetchLeads])

  function openModal(lead: CCLead) {
    setActiveLead(lead)
    setModalEstado(lead.ccEstado ?? '')
    setModalNotas(lead.ccNotas ?? '')
  }

  function closeModal() { setActiveLead(null) }

  async function saveCall() {
    if (!activeLead || !modalEstado) return
    setSaving(true)
    try {
      const res = await fetch('/api/coldcalling/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadEmail: activeLead.email, estado: modalEstado, notas: modalNotas }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setLeads((prev) => prev.map((l) => l.email === activeLead.email
        ? { ...l, ccEstado: modalEstado, ccNotas: modalNotas, ccUpdatedAt: new Date().toISOString() }
        : l
      ))
      setSaveMsg('Guardado y sincronizado')
      setTimeout(() => setSaveMsg(''), 3000)
      closeModal()
    } catch {
      setSaveMsg('Error al guardar. Inténtalo de nuevo.')
      setTimeout(() => setSaveMsg(''), 4000)
    } finally {
      setSaving(false)
    }
  }

  async function logout() {
    await fetch('/api/coldcalling/auth', { method: 'DELETE' })
    router.push('/coldcalling/login')
  }

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase()
    const matchSearch = !q
      || (l.nombre?.toLowerCase().includes(q) ?? false)
      || l.email.toLowerCase().includes(q)
      || (l.telefono?.includes(q) ?? false)
    const matchEstado = !filterEstado || l.ccEstado === filterEstado || (filterEstado === '__pending__' && !l.ccEstado)
    return matchSearch && matchEstado
  })

  const pending = leads.filter((l) => !l.ccEstado).length
  const done = leads.filter((l) => l.ccEstado).length
  const asisten = leads.filter((l) => l.ccEstado === 'llamada_asiste').length
  const noAsiste = leads.filter((l) => l.ccEstado === 'llamada_no_asiste').length
  const noContesta = leads.filter((l) => l.ccEstado === 'no_contesta').length
  const noExiste = leads.filter((l) => l.ccEstado === 'no_existe').length
  const llamarMasTarde = leads.filter((l) => l.ccEstado === 'llamar_mas_tarde').length

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center">
        <div className="text-[#94a3b8] text-sm animate-pulse">Cargando leads...</div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-sm">{fetchError}</p>
          <button
            onClick={() => fetchLeads(true)}
            className="px-4 py-2 bg-[#C9477A] text-white rounded-xl text-sm"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f0f1a]">
      {/* Header */}
      <header className="bg-[#1a1a2e] border-b border-[#2a2a3e] sticky top-0 z-20">
        <div className="h-0.5 bg-gradient-to-r from-transparent via-[#C9477A] to-transparent" />
        <div className="max-w-screen-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#C9477A]/20 border border-[#C9477A]/30 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C9477A">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight">Hola, {caller?.nombre}</p>
              <p className="text-xs text-[#4a4a6a]">Panel de llamadas</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saveMsg && <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg">{saveMsg}</span>}
            <button onClick={logout} className="text-xs text-[#4a4a6a] hover:text-[#94a3b8] transition-colors px-2 py-1">Salir</button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-lg mx-auto px-4 py-6 space-y-6">
        {/* KPIs — fila 1 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-white">{leads.length}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">Asignados</p>
          </div>
          <div className="bg-[#1a1a2e] border border-yellow-500/20 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-yellow-400">{pending}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">Pendientes</p>
          </div>
          <div className="bg-[#1a1a2e] border border-emerald-500/20 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{asisten}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">Asisten</p>
          </div>
        </div>

        {/* KPIs — lanzamiento */}
        {launchStats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#1a1a2e] border border-blue-500/20 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-400">{launchStats.reuniones}</p>
              <p className="text-xs text-[#4a4a6a] mt-0.5">Reuniones</p>
            </div>
            <div className="bg-[#1a1a2e] border border-emerald-500/20 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-400">{launchStats.ventas}</p>
              <p className="text-xs text-[#4a4a6a] mt-0.5">Ventas (setter+cobrador)</p>
            </div>
            <div className="bg-[#1a1a2e] border border-[#C9477A]/20 rounded-2xl p-4 text-center">
              <p className="text-lg font-bold text-[#C9477A]">{fmt(launchStats.cash_collected)}</p>
              <p className="text-xs text-[#4a4a6a] mt-0.5">Cash Collected</p>
            </div>
            <div className="bg-[#1a1a2e] border border-yellow-500/20 rounded-2xl p-4 text-center">
              <p className="text-lg font-bold text-yellow-400">{fmt(launchStats.comision)}</p>
              <p className="text-xs text-[#4a4a6a] mt-0.5">Comisión</p>
              <p className="text-[10px] text-[#4a4a6a] mt-0.5">70€ x3, 80€ x3-6, 100€ +6</p>
            </div>
          </div>
        )}

        {/* KPIs — fila 2 */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-[#1a1a2e] border border-red-500/20 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{noAsiste}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">No Asiste</p>
          </div>
          <div className="bg-[#1a1a2e] border border-orange-500/20 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-orange-400">{noContesta}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">No Contesta</p>
          </div>
          <div className="bg-[#1a1a2e] border border-[#3a3a5e] rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-[#94a3b8]">{noExiste}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">No Existe</p>
          </div>
          <div className="bg-[#1a1a2e] border border-blue-500/20 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">{llamarMasTarde}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">Llamar Más Tarde</p>
          </div>
        </div>

        {/* Progress bar */}
        {leads.length > 0 && (
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4">
            <div className="flex justify-between text-xs text-[#94a3b8] mb-2">
              <span>Progreso</span>
              <span>{done} de {leads.length} llamadas</span>
            </div>
            <div className="h-2 bg-[#2a2a3e] rounded-full overflow-hidden">
              <div className="h-full bg-[#C9477A] rounded-full transition-all" style={{ width: `${leads.length > 0 ? Math.round((done / leads.length) * 100) : 0}%` }} />
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="Buscar por nombre, email o teléfono..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A] transition-colors"
          />
          <select
            value={filterEstado}
            onChange={(e) => setFilterEstado(e.target.value)}
            className="px-3 py-2 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl text-sm text-[#94a3b8] focus:outline-none focus:border-[#C9477A] transition-colors"
          >
            <option value="">Todos</option>
            <option value="__pending__">Pendientes</option>
            {ESTADOS.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
          </select>
        </div>

        {/* Leads list */}
        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-[#4a4a6a] text-sm">No hay leads que coincidan.</div>
          ) : (
            filtered.map((lead) => {
              const meta = estadoMeta(lead.ccEstado)
              return (
                <div
                  key={lead.email}
                  onClick={() => openModal(lead)}
                  className="bg-[#1a1a2e] border border-[#2a2a3e] hover:border-[#C9477A]/40 rounded-2xl p-4 cursor-pointer transition-all active:scale-[0.99]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-white font-semibold text-sm">{lead.nombre || '—'}</p>
                        {!lead.ccEstado && (
                          <span className="text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 px-1.5 py-0.5 rounded-full">Pendiente</span>
                        )}
                      </div>
                      <p className="text-xs text-[#4a4a6a] mt-0.5">{lead.email}</p>
                      <p className="text-sm text-[#94a3b8] font-mono mt-1">{formatPhone(lead.telefono).display}</p>
                      {lead.ccNotas && (
                        <p className="text-xs text-[#94a3b8]/70 mt-1 italic line-clamp-1">"{lead.ccNotas}"</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      {meta ? (
                        <span className={`text-xs border px-2 py-0.5 rounded-full whitespace-nowrap ${meta.bg} ${meta.color}`}>
                          {meta.label}
                        </span>
                      ) : (
                        <span className="text-xs bg-[#2a2a3e] text-[#94a3b8] border border-[#3a3a5e] px-2 py-0.5 rounded-full">Llamar</span>
                      )}
                      <span className="text-xs text-[#4a4a6a] flex items-center gap-1">
                        {lead.ccEstado ? 'Actualizar' : 'Registrar'}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </main>

      {/* Call Modal */}
      {activeLead && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-3xl w-full max-w-md p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
            {/* Lead info */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-white font-bold text-lg leading-tight">{activeLead.nombre}</h3>
                {activeLead.ccEstado && (
                  <span className="text-xs text-[#4a4a6a] bg-[#2a2a3e] border border-[#3a3a5e] px-2 py-0.5 rounded-full">Actualizando</span>
                )}
              </div>
              <p className="text-[#4a4a6a] text-xs">{activeLead.email}</p>
              {(() => {
                const { display, tel } = formatPhone(activeLead.telefono)
                return tel ? (
                  <a
                    href={`tel:${tel}`}
                    className="inline-flex items-center gap-2 mt-2 text-[#C9477A] font-mono text-base font-semibold hover:text-[#e05a8a] transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    {display}
                  </a>
                ) : (
                  <p className="mt-2 text-[#4a4a6a] text-sm">Sin teléfono</p>
                )
              })()}
            </div>

            {/* Estado */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-[#94a3b8]">Resultado de la llamada</p>
                {modalEstado && (
                  <button
                    onClick={() => setModalEstado('')}
                    className="text-xs text-[#4a4a6a] hover:text-[#94a3b8] transition-colors"
                  >
                    Limpiar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ESTADOS.map((e) => (
                  <button
                    key={e.value}
                    onClick={() => setModalEstado(e.value)}
                    className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition-all ${
                      modalEstado === e.value
                        ? `${e.bg} ${e.color} scale-[1.02]`
                        : 'bg-[#0f0f1a] border-[#2a2a3e] text-[#94a3b8] hover:border-[#3a3a5e]'
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notas */}
            <div>
              <p className="text-xs text-[#94a3b8] mb-2">Notas</p>
              <textarea
                value={modalNotas}
                onChange={(e) => setModalNotas(e.target.value)}
                placeholder="Añade notas sobre la llamada..."
                rows={3}
                className="w-full px-4 py-2.5 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A] transition-colors resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={closeModal} className="flex-1 py-2.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#94a3b8] rounded-xl text-sm transition-colors">
                Cancelar
              </button>
              <button
                onClick={saveCall}
                disabled={!modalEstado || saving}
                className="flex-1 py-2.5 bg-[#C9477A] hover:bg-[#b03868] disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors"
              >
                {saving ? 'Guardando...' : activeLead.ccEstado ? 'Actualizar' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
