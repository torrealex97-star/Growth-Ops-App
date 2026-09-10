'use client'

import { useState, useEffect, useCallback } from 'react'

interface Caller { id: number; email: string; nombre: string; activa: boolean; peso: number }
interface Stats {
  coldcaller_id: number; nombre: string; email: string
  total_asignados: number; llamadas_realizadas: number
  asisten: number; no_asisten: number; no_contesta: number; no_existe: number; llamar_mas_tarde: number; alumna_bw: number
}
interface Assignment { lead_email: string; coldcaller_id: number; coldcaller_nombre: string }
interface AdminLead {
  email: string; nombre: string; telefono: string; fechaRegistro: string
  asignadaA: string | null; asignadaId: number | null
  ccEstado: string | null; ccNotas: string | null; ccUpdatedAt: string | null
}

const MEDAL = [
  { bg: 'bg-yellow-400/15', border: 'border-yellow-400/30', text: 'text-yellow-400', label: '1º' },
  { bg: 'bg-slate-400/15', border: 'border-slate-400/30', text: 'text-slate-300', label: '2º' },
  { bg: 'bg-amber-600/15', border: 'border-amber-600/30', text: 'text-amber-500', label: '3º' },
]

const ESTADO_META: Record<string, { label: string; cls: string }> = {
  llamada_asiste:    { label: 'Asiste',       cls: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/25' },
  llamada_no_asiste: { label: 'No Asiste',    cls: 'text-red-400 bg-red-500/15 border-red-500/25' },
  no_contesta:       { label: 'No Contesta',  cls: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/25' },
  no_existe:         { label: 'No Existe',    cls: 'text-[#4a4a6a] bg-[#2a2a3e] border-[#3a3a5e]' },
  llamar_mas_tarde:  { label: 'Llamar Más Tarde', cls: 'text-blue-400 bg-blue-500/15 border-blue-500/25' },
  alumna_bw:         { label: 'Alumna BW',        cls: 'text-purple-400 bg-purple-500/15 border-purple-500/25' },
}

export default function AdminColdCalling() {
  const [callers, setCallers] = useState<Caller[]>([])
  const [stats, setStats] = useState<Stats[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)

  // Leads view
  const [leads, setLeads] = useState<AdminLead[]>([])
  const [leadsLoading, setLeadsLoading] = useState(false)
  const [leadsLoaded, setLeadsLoaded] = useState(false)
  const [leadsSearch, setLeadsSearch] = useState('')
  const [leadsFilterCaller, setLeadsFilterCaller] = useState('')
  const [leadsFilterEstado, setLeadsFilterEstado] = useState('')

  // New caller form
  const [form, setForm] = useState({ email: '', nombre: '', password: '', peso: '100' })
  const [creating, setCreating] = useState(false)
  const [formMsg, setFormMsg] = useState('')

  // Reassign
  const [reassignEmail, setReassignEmail] = useState('')
  const [reassignTo, setReassignTo] = useState('')
  const [reassigning, setReassigning] = useState(false)

  // Assign button
  const [assigning, setAssigning] = useState(false)
  const [assignMsg, setAssignMsg] = useState('')

  // Sync sheet button
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // Sync cache button
  const [syncingCache, setSyncingCache] = useState(false)

  const fetchAll = useCallback(async () => {
    const [callersRes, statsRes] = await Promise.all([
      fetch('/api/coldcalling/admin/callers'),
      fetch('/api/coldcalling/admin/stats'),
    ])
    if (callersRes.ok) setCallers(await callersRes.json())
    if (statsRes.ok) {
      const d = await statsRes.json()
      setStats(d.stats || [])
      setAssignments(d.assignments || [])
    }
    setLoading(false)
  }, [])

  async function loadLeads() {
    if (leadsLoaded) return
    setLeadsLoading(true)
    const res = await fetch('/api/coldcalling/admin/leads')
    if (res.ok) setLeads(await res.json())
    setLeadsLoading(false)
    setLeadsLoaded(true)
  }

  useEffect(() => { fetchAll() }, [fetchAll])

  async function createCaller() {
    if (!form.email || !form.nombre || !form.password) return
    setCreating(true)
    const res = await fetch('/api/coldcalling/admin/callers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, peso: parseInt(form.peso) || 100 }),
    })
    setCreating(false)
    if (res.ok) {
      setFormMsg('Cold caller creada correctamente')
      setForm({ email: '', nombre: '', password: '', peso: '100' })
      fetchAll()
      setTimeout(() => setFormMsg(''), 3000)
    } else {
      const d = await res.json()
      setFormMsg(d.error || 'Error al crear')
    }
  }

  async function toggleActive(caller: Caller) {
    await fetch('/api/coldcalling/admin/callers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: caller.id, activa: !caller.activa }),
    })
    fetchAll()
  }

  async function updatePeso(caller: Caller, peso: number) {
    await fetch('/api/coldcalling/admin/callers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: caller.id, peso }),
    })
    fetchAll()
  }

  async function syncCache() {
    setSyncingCache(true)
    setSyncMsg('Actualizando en segundo plano...')
    // Fire-and-forget — don't await, Vercel runs it up to 60s in background
    fetch('/api/coldcalling/admin/sync-cache', { method: 'POST' }).catch(() => {})
    // Return control to the user immediately
    setSyncingCache(false)
    setSyncMsg('Cache actualizándose en segundo plano. Lista en ~30s.')
    setTimeout(() => setSyncMsg(''), 10000)
  }

  async function syncSheet() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await fetch('/api/coldcalling/admin/sync-sheet', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || `Error ${res.status}`)
      setSyncMsg(`✓ ${d.synced} asignaciones sincronizadas en Excel`)
    } catch (e) {
      setSyncMsg(`Error al sincronizar: ${e instanceof Error ? e.message : 'desconocido'}`)
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(''), 8000)
    }
  }

  async function triggerAssign() {
    setAssigning(true)
    setAssignMsg('')
    try {
      const res = await fetch('/api/coldcalling/admin/assign', { method: 'POST' })
      const text = await res.text()
      const d = text ? JSON.parse(text) : {}
      if (!res.ok) throw new Error(d.error || `Error ${res.status}`)
      setAssignMsg(d.assigned > 0 ? `✓ ${d.assigned} leads asignados` : 'No hay leads nuevos sin asignar')
      if (d.assigned > 0) fetchAll()
    } catch (e) {
      setAssignMsg(`Error: ${e instanceof Error ? e.message : 'desconocido'}`)
    } finally {
      setAssigning(false)
      setTimeout(() => setAssignMsg(''), 6000)
    }
  }

  async function doReassign() {
    if (!reassignEmail || !reassignTo) return
    setReassigning(true)
    await fetch('/api/coldcalling/admin/reassign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadEmail: reassignEmail, callerId: parseInt(reassignTo) }),
    })
    setReassigning(false)
    setReassignEmail('')
    setReassignTo('')
    fetchAll()
  }

  const top3 = stats.slice(0, 3)

  if (loading) return (
    <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center">
      <p className="text-[#94a3b8] text-sm">Cargando...</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#0f0f1a]">
      <header className="bg-[#1a1a2e] border-b border-[#2a2a3e] sticky top-0 z-10">
        <div className="h-0.5 bg-gradient-to-r from-transparent via-[#C9477A] to-transparent" />
        <div className="max-w-screen-xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-xs text-[#4a4a6a] hover:text-[#94a3b8] transition-colors">← Dashboard</a>
            <span className="text-[#2a2a3e]">|</span>
            <h1 className="text-white font-bold text-sm">Admin Cold Calling</h1>
          </div>
          <div className="flex items-center gap-3">
            {(assignMsg || syncMsg) && (
              <span className="text-xs text-emerald-400">{syncMsg || assignMsg}</span>
            )}
            <button
              onClick={syncCache}
              disabled={syncingCache}
              className="px-3 py-1.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] disabled:opacity-50 text-[#94a3b8] text-xs font-semibold rounded-xl transition-colors border border-[#3a3a5e]"
            >
              {syncingCache ? 'Actualizando...' : 'Actualizar cache'}
            </button>
            <button
              onClick={syncSheet}
              disabled={syncing}
              className="px-3 py-1.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] disabled:opacity-50 text-[#94a3b8] text-xs font-semibold rounded-xl transition-colors border border-[#3a3a5e]"
            >
              {syncing ? 'Sincronizando...' : 'Sincronizar Excel'}
            </button>
            <button
              onClick={triggerAssign}
              disabled={assigning}
              className="px-3 py-1.5 bg-[#C9477A] hover:bg-[#b03868] disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors"
            >
              {assigning ? 'Asignando...' : 'Asignar leads nuevos'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-4 py-6 space-y-8">

        {/* Podium */}
        {top3.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
              <h2 className="text-lg font-bold text-white">Ranking Cold Callers</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              {top3.map((s, i) => {
                const medal = MEDAL[i]
                const pct = s.total_asignados > 0 ? Math.round((s.llamadas_realizadas / s.total_asignados) * 100) : 0
                const tasaAsistencia = s.llamadas_realizadas > 0 ? Math.round((s.asisten / s.llamadas_realizadas) * 100) : 0
                return (
                  <div key={s.coldcaller_id} className={`bg-[#1a1a2e] border ${medal.border} rounded-2xl p-5 relative`}>
                    <div className={`absolute top-4 right-4 w-7 h-7 rounded-full ${medal.bg} border ${medal.border} flex items-center justify-center`}>
                      <span className={`text-xs font-bold ${medal.text}`}>{medal.label}</span>
                    </div>
                    <p className={`text-2xl font-bold ${medal.text}`}>{s.asisten}</p>
                    <p className="text-white font-semibold text-sm mt-0.5 pr-8">{s.nombre}</p>
                    <p className="text-xs text-[#4a4a6a]">{s.email}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-[#0f0f1a] rounded-xl p-2 text-center">
                        <p className="text-white font-bold">{s.llamadas_realizadas}</p>
                        <p className="text-[#4a4a6a]">Llamadas</p>
                      </div>
                      <div className="bg-[#0f0f1a] rounded-xl p-2 text-center">
                        <p className="text-emerald-400 font-bold">{tasaAsistencia}%</p>
                        <p className="text-[#4a4a6a]">Asistencia</p>
                      </div>
                    </div>
                    <div className="mt-3 h-1.5 bg-[#2a2a3e] rounded-full overflow-hidden">
                      <div className="h-full bg-[#C9477A] rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-[#4a4a6a] mt-1">{pct}% de leads llamados</p>
                  </div>
                )
              })}
            </div>

            {/* Full stats table */}
            {stats.length > 0 && (
              <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[#94a3b8] border-b border-[#2a2a3e] text-left">
                      <th className="px-5 py-3 font-medium">#</th>
                      <th className="px-5 py-3 font-medium">Nombre</th>
                      <th className="px-5 py-3 font-medium">Asignados</th>
                      <th className="px-5 py-3 font-medium">Llamadas</th>
                      <th className="px-5 py-3 font-medium text-emerald-400">Asiste</th>
                      <th className="px-5 py-3 font-medium text-red-400">No Asiste</th>
                      <th className="px-5 py-3 font-medium text-yellow-400">No Contesta</th>
                      <th className="px-5 py-3 font-medium text-[#4a4a6a]">No Existe</th>
                      <th className="px-5 py-3 font-medium text-blue-400">Llamar Más Tarde</th>
                      <th className="px-5 py-3 font-medium text-purple-400">Alumna BW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.map((s, i) => (
                      <tr key={s.coldcaller_id} className="border-b border-[#2a2a3e]/40 hover:bg-[#222238] transition-colors">
                        <td className="px-5 py-3 text-[#4a4a6a]">{i + 1}</td>
                        <td className="px-5 py-3">
                          <p className="text-white font-medium">{s.nombre}</p>
                          <p className="text-xs text-[#4a4a6a]">{s.email}</p>
                        </td>
                        <td className="px-5 py-3 text-[#94a3b8]">{s.total_asignados}</td>
                        <td className="px-5 py-3 text-[#94a3b8]">{s.llamadas_realizadas}</td>
                        <td className="px-5 py-3 text-emerald-400 font-semibold">{s.asisten}</td>
                        <td className="px-5 py-3 text-red-400">{s.no_asisten}</td>
                        <td className="px-5 py-3 text-yellow-400">{s.no_contesta}</td>
                        <td className="px-5 py-3 text-[#4a4a6a]">{s.no_existe}</td>
                        <td className="px-5 py-3 text-blue-400">{s.llamar_mas_tarde ?? 0}</td>
                        <td className="px-5 py-3 text-purple-400">{s.alumna_bw ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Cold callers management */}
          <section>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
              <h2 className="text-lg font-bold text-white">Cold Callers</h2>
            </div>

            <div className="space-y-2 mb-4">
              {callers.map((c) => (
                <div key={c.id} className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{c.nombre}</p>
                    <p className="text-xs text-[#4a4a6a]">{c.email}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-[#4a4a6a]">Peso</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        defaultValue={c.peso}
                        onBlur={(e) => updatePeso(c, parseInt(e.target.value))}
                        className="w-14 px-2 py-1 bg-[#0f0f1a] border border-[#2a2a3e] rounded-lg text-white text-xs text-center focus:outline-none focus:border-[#C9477A]"
                      />
                    </div>
                    <button
                      onClick={() => toggleActive(c)}
                      className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                        c.activa ? 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10' : 'text-[#4a4a6a] border-[#3a3a5e] bg-[#2a2a3e]'
                      }`}
                    >
                      {c.activa ? 'Activa' : 'Inactiva'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Create form */}
            <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 space-y-3">
              <p className="text-sm text-white font-medium">Añadir cold caller</p>
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  className="px-3 py-2 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A]" />
                <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="px-3 py-2 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A]" />
                <input placeholder="Contraseña" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="px-3 py-2 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A]" />
                <input placeholder="Peso (1-100)" type="number" value={form.peso} onChange={(e) => setForm({ ...form, peso: e.target.value })}
                  className="px-3 py-2 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A]" />
              </div>
              {formMsg && <p className="text-xs text-emerald-400">{formMsg}</p>}
              <button onClick={createCaller} disabled={creating}
                className="w-full py-2.5 bg-[#C9477A] hover:bg-[#b03868] disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors">
                {creating ? 'Creando...' : 'Crear cold caller'}
              </button>
            </div>
          </section>

          {/* Reassign leads */}
          <section>
            <div className="flex items-center gap-3 mb-5">
              <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
              <h2 className="text-lg font-bold text-white">Reasignar lead</h2>
            </div>
            <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 space-y-3">
              <input
                placeholder="Email del lead"
                value={reassignEmail}
                onChange={(e) => setReassignEmail(e.target.value)}
                list="assignments-list"
                className="w-full px-4 py-2.5 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A]"
              />
              <datalist id="assignments-list">
                {assignments.map((a) => <option key={a.lead_email} value={a.lead_email} label={`→ ${a.coldcaller_nombre}`} />)}
              </datalist>
              <select
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-sm text-[#94a3b8] focus:outline-none focus:border-[#C9477A]"
              >
                <option value="">Asignar a...</option>
                {callers.filter((c) => c.activa).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <button onClick={doReassign} disabled={!reassignEmail || !reassignTo || reassigning}
                className="w-full py-2.5 bg-[#C9477A] hover:bg-[#b03868] disabled:opacity-40 text-white font-semibold rounded-xl text-sm transition-colors">
                {reassigning ? 'Reasignando...' : 'Reasignar'}
              </button>
            </div>

            {/* Recent assignments */}
            <div className="mt-4 bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden max-h-72 overflow-y-auto">
              <div className="px-4 py-2.5 border-b border-[#2a2a3e]">
                <p className="text-xs text-[#94a3b8] font-medium">Asignaciones recientes ({assignments.length})</p>
              </div>
              {assignments.slice(0, 50).map((a) => (
                <div key={a.lead_email} className="flex items-center gap-3 px-4 py-2.5 border-b border-[#2a2a3e]/40 hover:bg-[#222238] transition-colors">
                  <span className="flex-1 text-xs text-[#94a3b8] truncate">{a.lead_email}</span>
                  <span className="text-xs text-[#C9477A] flex-shrink-0">{a.coldcaller_nombre}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* All leads view */}
        <section>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-1 h-6 bg-[#C9477A] rounded-full" />
            <h2 className="text-lg font-bold text-white">Todos los Leads</h2>
            {leadsLoaded && (
              <span className="text-xs text-[#94a3b8] bg-[#1a1a2e] border border-[#2a2a3e] px-2 py-0.5 rounded-full">
                {leads.length} leads
              </span>
            )}
            {!leadsLoaded && (
              <button
                onClick={loadLeads}
                disabled={leadsLoading}
                className="px-3 py-1.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] disabled:opacity-50 text-[#94a3b8] text-xs rounded-xl transition-colors"
              >
                {leadsLoading ? 'Cargando...' : 'Cargar leads'}
              </button>
            )}
            {leadsLoaded && (
              <button
                onClick={() => { setLeadsLoaded(false); loadLeads() }}
                className="px-3 py-1.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#94a3b8] text-xs rounded-xl transition-colors ml-auto"
              >
                Actualizar
              </button>
            )}
          </div>

          {leadsLoaded && (
            <>
              {/* Filters */}
              <div className="flex flex-wrap gap-3 mb-4">
                <input
                  type="text"
                  placeholder="Buscar por nombre, email o teléfono..."
                  value={leadsSearch}
                  onChange={(e) => setLeadsSearch(e.target.value)}
                  className="flex-1 min-w-[200px] px-4 py-2 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A] transition-colors"
                />
                <select
                  value={leadsFilterCaller}
                  onChange={(e) => setLeadsFilterCaller(e.target.value)}
                  className="px-3 py-2 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl text-sm text-[#94a3b8] focus:outline-none focus:border-[#C9477A] transition-colors"
                >
                  <option value="">Todas las callers</option>
                  <option value="__sin__">Sin asignar</option>
                  {callers.map((c) => <option key={c.id} value={String(c.id)}>{c.nombre}</option>)}
                </select>
                <select
                  value={leadsFilterEstado}
                  onChange={(e) => setLeadsFilterEstado(e.target.value)}
                  className="px-3 py-2 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl text-sm text-[#94a3b8] focus:outline-none focus:border-[#C9477A] transition-colors"
                >
                  <option value="">Todos los estados</option>
                  <option value="__pending__">Sin llamar</option>
                  <option value="llamada_asiste">Asiste</option>
                  <option value="llamada_no_asiste">No Asiste</option>
                  <option value="no_contesta">No Contesta</option>
                  <option value="no_existe">No Existe</option>
                  <option value="llamar_mas_tarde">Llamar Más Tarde</option>
                  <option value="alumna_bw">Alumna BW</option>
                </select>
              </div>

              {/* Table */}
              <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[#94a3b8] border-b border-[#2a2a3e] text-left">
                        <th className="px-4 py-3 font-medium">Nombre</th>
                        <th className="px-4 py-3 font-medium">Email / Teléfono</th>
                        <th className="px-4 py-3 font-medium">Asignada a</th>
                        <th className="px-4 py-3 font-medium">Estado llamada</th>
                        <th className="px-4 py-3 font-medium">Notas</th>
                        <th className="px-4 py-3 font-medium">Reasignar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads
                        .filter((l) => {
                          const q = leadsSearch.toLowerCase()
                          const matchSearch = !q || l.nombre.toLowerCase().includes(q) || l.email.toLowerCase().includes(q) || l.telefono?.includes(q)
                          const matchCaller =
                            !leadsFilterCaller ||
                            (leadsFilterCaller === '__sin__' && !l.asignadaId) ||
                            l.asignadaId === parseInt(leadsFilterCaller)
                          const matchEstado =
                            !leadsFilterEstado ||
                            (leadsFilterEstado === '__pending__' && !l.ccEstado) ||
                            l.ccEstado === leadsFilterEstado
                          return matchSearch && matchCaller && matchEstado
                        })
                        .slice(0, 200)
                        .map((l) => {
                          const estado = l.ccEstado ? ESTADO_META[l.ccEstado] : null
                          return (
                            <tr key={l.email} className="border-b border-[#2a2a3e]/40 hover:bg-[#222238] transition-colors">
                              <td className="px-4 py-3 text-white font-medium whitespace-nowrap">{l.nombre || '—'}</td>
                              <td className="px-4 py-3">
                                <p className="text-xs text-[#4a4a6a]">{l.email}</p>
                                <p className="text-sm text-[#94a3b8] font-mono">{l.telefono}</p>
                              </td>
                              <td className="px-4 py-3">
                                {l.asignadaA ? (
                                  <span className="text-xs text-[#C9477A] bg-[#C9477A]/10 border border-[#C9477A]/20 px-2 py-0.5 rounded-full whitespace-nowrap">
                                    {l.asignadaA}
                                  </span>
                                ) : (
                                  <span className="text-xs text-[#4a4a6a]">Sin asignar</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {estado ? (
                                  <span className={`text-xs border px-2 py-0.5 rounded-full whitespace-nowrap ${estado.cls}`}>
                                    {estado.label}
                                  </span>
                                ) : (
                                  <span className="text-xs text-[#4a4a6a]">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-xs text-[#94a3b8] max-w-[180px]">
                                <span className="line-clamp-2" title={l.ccNotas || ''}>{l.ccNotas || '—'}</span>
                              </td>
                              <td className="px-4 py-3">
                                <select
                                  defaultValue=""
                                  onChange={async (e) => {
                                    if (!e.target.value) return
                                    await fetch('/api/coldcalling/admin/reassign', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ leadEmail: l.email, callerId: parseInt(e.target.value) }),
                                    })
                                    e.target.value = ''
                                    setLeadsLoaded(false)
                                    loadLeads()
                                  }}
                                  className="px-2 py-1 bg-[#0f0f1a] border border-[#2a2a3e] rounded-lg text-xs text-[#94a3b8] focus:outline-none focus:border-[#C9477A] transition-colors"
                                >
                                  <option value="">Reasignar...</option>
                                  {callers.filter((c) => c.activa).map((c) => (
                                    <option key={c.id} value={c.id}>{c.nombre}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
