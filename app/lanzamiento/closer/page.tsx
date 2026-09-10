'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface LaunchSale {
  id: number; fecha: string; nombre: string | null; apellido: string | null
  email: string | null; plataforma: string | null; tipo_pago: string | null
  cash_collected: number | null; closer_nombre?: string
  coldcaller_nombre?: string; afiliado_email: string | null; created_at: string
}

const PLATAFORMAS = ['Stripe', 'Sequra', 'Transferencia']
const TIPOS_PAGO = ['Reserva', 'FullPay', '2Pagos', '3Pagos', '4Pagos', 'Sequra6pagos', 'Sequra12pagos']

function fmt(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}

function emptyForm() {
  return {
    fecha: new Date().toISOString().slice(0, 10),
    nombre: '', apellido: '', telefono: '', email: '',
    plataforma: '', valor: '', tipo_pago: '', cash_collected: '',
    coldcaller_id: '', coldcaller_nombre: '', lead_email: '',
    afiliado_email: '', utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
  }
}

export default function CloserDashboard() {
  const router = useRouter()
  const [closer, setCloser] = useState<{ id: number; nombre: string } | null>(null)
  const [stats, setStats] = useState<{ ventas: number; cash_collected: number; facturacion: number; pendiente: number; comision: number; comision_actual: number; comision_total: number } | null>(null)
  const [sales, setSales] = useState<LaunchSale[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [lookupQ, setLookupQ] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupMsg, setLookupMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/lanzamiento/closer/me')
      if (res.status === 401) { router.push('/lanzamiento/closer/login'); return }
      if (!res.ok) { setLoading(false); return }
      const data = await res.json()
      setCloser(data.closer)
      setStats(data.stats)
      setSales(data.sales || [])
    } catch {
      // network error — stay on page
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { fetchData() }, [fetchData])

  async function lookupLead() {
    if (!lookupQ.trim()) return
    setLookupLoading(true)
    setLookupMsg('')
    const res = await fetch(`/api/lanzamiento/closer/lookup?q=${encodeURIComponent(lookupQ)}`)
    const data = await res.json()
    setLookupLoading(false)
    if (!data.found) {
      setLookupMsg('Lead no encontrado. Puedes rellenar los datos manualmente.')
      return
    }
    setForm(prev => ({
      ...prev,
      nombre: data.lead.nombre?.split(' ')[0] || '',
      apellido: data.lead.nombre?.split(' ').slice(1).join(' ') || '',
      telefono: data.lead.telefono || '',
      email: data.lead.email || '',
      lead_email: data.lead.email || '',
      coldcaller_id: data.coldcaller?.id ? String(data.coldcaller.id) : '',
      coldcaller_nombre: data.coldcaller?.nombre || '',
      afiliado_email: data.lead.afiliado_email || '',
      utm_source: data.lead.utm_source || '',
      utm_medium: data.lead.utm_medium || '',
      utm_campaign: data.lead.utm_campaign || '',
      utm_content: data.lead.utm_content || '',
      utm_term: data.lead.utm_term || '',
    }))
    setLookupMsg(data.coldcaller ? `✓ Lead encontrado · Setter: ${data.coldcaller.nombre}` : '✓ Lead encontrado (sin setter asignado)')
  }

  async function submitSale(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveMsg('')
    const res = await fetch('/api/lanzamiento/closer/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        valor: form.valor ? Number(form.valor) : null,
        cash_collected: form.cash_collected ? Number(form.cash_collected) : null,
        coldcaller_id: form.coldcaller_id ? Number(form.coldcaller_id) : null,
      }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setSaveMsg(data.error || 'Error al registrar'); return }
    setSaveMsg('¡Venta registrada correctamente!')
    setForm(emptyForm())
    setLookupQ('')
    setLookupMsg('')
    setShowForm(false)
    fetchData()
    setTimeout(() => setSaveMsg(''), 5000)
  }

  async function logout() {
    await fetch('/api/lanzamiento/closer/auth', { method: 'DELETE' })
    router.push('/lanzamiento/closer/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f0f1a] flex items-center justify-center">
        <p className="text-[#94a3b8] text-sm animate-pulse">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0f0f1a]">
      <header className="bg-[#1a1a2e] border-b border-[#2a2a3e] sticky top-0 z-20">
        <div className="h-0.5 bg-gradient-to-r from-transparent via-[#C9477A] to-transparent" />
        <div className="max-w-screen-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#C9477A]/20 border border-[#C9477A]/30 flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C9477A">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-white font-semibold text-sm leading-tight">Hola, {closer?.nombre}</p>
              <p className="text-xs text-[#4a4a6a]">Panel Closers · Lanzamiento</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {saveMsg && <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg">{saveMsg}</span>}
            <button onClick={logout} className="text-xs text-[#4a4a6a] hover:text-[#94a3b8] transition-colors px-2 py-1">Salir</button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-lg mx-auto px-4 py-6 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
          <div className="bg-[#1a1a2e] border border-emerald-500/20 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-emerald-400">{stats?.ventas ?? 0}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">Ventas</p>
          </div>
          <div className="bg-[#1a1a2e] border border-[#C9477A]/20 rounded-2xl p-4 text-center">
            <p className="text-lg font-bold text-[#C9477A]">{fmt(stats?.facturacion ?? 0)}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">Facturación</p>
          </div>
          <div className="bg-[#1a1a2e] border border-emerald-500/20 rounded-2xl p-4 text-center">
            <p className="text-lg font-bold text-emerald-300">{fmt(stats?.cash_collected ?? 0)}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">Cash Collected</p>
            <p className="text-[10px] text-orange-300 mt-0.5">Pendiente: {fmt(stats?.pendiente ?? 0)}</p>
          </div>
          <div className="bg-[#1a1a2e] border border-yellow-500/20 rounded-2xl p-4 text-center">
            <p className="text-lg font-bold text-yellow-400">{fmt(stats?.comision_actual ?? stats?.comision ?? 0)}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">Comisión actual</p>
            <p className="text-[10px] text-[#4a4a6a] mt-0.5">8% del cash</p>
          </div>
          <div className="bg-[#1a1a2e] border border-yellow-500/10 rounded-2xl p-4 text-center">
            <p className="text-lg font-bold text-yellow-200">{fmt(stats?.comision_total ?? 0)}</p>
            <p className="text-xs text-[#4a4a6a] mt-0.5">Comisión total</p>
            <p className="text-[10px] text-[#4a4a6a] mt-0.5">al cobrar todo</p>
          </div>
        </div>

        {/* Register sale button */}
        <button
          onClick={() => setShowForm(!showForm)}
          className="w-full py-3 bg-[#C9477A] hover:bg-[#b03868] text-white font-semibold rounded-2xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {showForm ? 'Cancelar' : 'Registrar Venta'}
        </button>

        {/* Sale form */}
        {showForm && (
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-5 space-y-5">
            <h3 className="text-white font-semibold text-sm">Nueva Venta</h3>

            {/* Lead lookup */}
            <div>
              <p className="text-xs text-[#94a3b8] mb-2">Buscar lead por email o teléfono</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={lookupQ}
                  onChange={(e) => setLookupQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), lookupLead())}
                  placeholder="email@ejemplo.com o 612345678"
                  className="flex-1 px-4 py-2.5 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A] transition-colors"
                />
                <button onClick={lookupLead} disabled={lookupLoading}
                  className="px-4 py-2.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#94a3b8] rounded-xl text-sm transition-colors disabled:opacity-50">
                  {lookupLoading ? '...' : 'Buscar'}
                </button>
              </div>
              {lookupMsg && (
                <p className={`text-xs mt-1.5 ${lookupMsg.startsWith('✓') ? 'text-emerald-400' : 'text-yellow-400'}`}>
                  {lookupMsg}
                </p>
              )}
            </div>

            <form onSubmit={submitSale} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fecha *" required>
                  <input type="date" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} required className={inputCls} />
                </Field>
                <Field label="Plataforma *" required>
                  <select value={form.plataforma} onChange={e => setForm(p => ({ ...p, plataforma: e.target.value }))} required className={inputCls}>
                    <option value="">Seleccionar</option>
                    {PLATAFORMAS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Nombre *" required>
                  <input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} required placeholder="María" className={inputCls} />
                </Field>
                <Field label="Apellido">
                  <input value={form.apellido} onChange={e => setForm(p => ({ ...p, apellido: e.target.value }))} placeholder="García" className={inputCls} />
                </Field>
                <Field label="Email *" required>
                  <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required placeholder="lead@email.com" className={inputCls} />
                </Field>
                <Field label="Teléfono">
                  <input value={form.telefono} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))} placeholder="612345678" className={inputCls} />
                </Field>
                <Field label="Valor (€)">
                  <input type="number" step="0.01" value={form.valor} onChange={e => setForm(p => ({ ...p, valor: e.target.value }))} placeholder="1997" className={inputCls} />
                </Field>
                <Field label="Cash Collected (€)">
                  <input type="number" step="0.01" value={form.cash_collected} onChange={e => setForm(p => ({ ...p, cash_collected: e.target.value }))} placeholder="1997" className={inputCls} />
                </Field>
                <Field label="Tipo de Pago *" required>
                  <select value={form.tipo_pago} onChange={e => setForm(p => ({ ...p, tipo_pago: e.target.value }))} required className={inputCls}>
                    <option value="">Seleccionar</option>
                    {TIPOS_PAGO.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="Setter (Cold Caller)">
                  <input value={form.coldcaller_nombre} readOnly placeholder="Auto desde búsqueda"
                    className={`${inputCls} opacity-60 cursor-not-allowed`} />
                </Field>
              </div>

              {form.afiliado_email && (
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl px-3 py-2">
                  <p className="text-xs text-purple-400">Afiliado detectado: <span className="font-medium">{form.afiliado_email}</span></p>
                </div>
              )}

              {(form.utm_source || form.utm_medium || form.utm_campaign || form.utm_content || form.utm_term) && (
                <div className="bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl p-3 space-y-1.5">
                  <p className="text-xs text-[#4a4a6a] font-medium uppercase tracking-wider">UTMs del lead</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {form.utm_source && <p className="text-xs text-[#94a3b8]"><span className="text-[#4a4a6a]">Source:</span> {form.utm_source}</p>}
                    {form.utm_medium && <p className="text-xs text-[#94a3b8]"><span className="text-[#4a4a6a]">Medium:</span> {form.utm_medium}</p>}
                    {form.utm_campaign && <p className="text-xs text-[#94a3b8]"><span className="text-[#4a4a6a]">Campaign:</span> {form.utm_campaign}</p>}
                    {form.utm_content && <p className="text-xs text-[#94a3b8]"><span className="text-[#4a4a6a]">Content:</span> {form.utm_content}</p>}
                    {form.utm_term && <p className="text-xs text-[#94a3b8]"><span className="text-[#4a4a6a]">Term:</span> {form.utm_term}</p>}
                  </div>
                </div>
              )}

              <button type="submit" disabled={saving}
                className="w-full py-3 bg-[#C9477A] hover:bg-[#b03868] disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors">
                {saving ? 'Registrando...' : 'Confirmar Venta'}
              </button>
            </form>
          </div>
        )}

        {/* Sales history */}
        {sales.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[#94a3b8] text-xs font-medium uppercase tracking-wider">Tus ventas</h3>
            {sales.map((sale) => (
              <div key={sale.id} className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-white font-semibold text-sm">{[sale.nombre, sale.apellido].filter(Boolean).join(' ') || sale.email || '—'}</p>
                    <p className="text-xs text-[#4a4a6a] mt-0.5">{sale.email} · {sale.fecha ? new Date(sale.fecha).toLocaleDateString('es-ES') : '—'}</p>
                    <div className="flex gap-2 mt-1.5 flex-wrap">
                      {sale.plataforma && <span className="text-xs bg-[#2a2a3e] text-[#94a3b8] px-2 py-0.5 rounded-full">{sale.plataforma}</span>}
                      {sale.tipo_pago && <span className="text-xs bg-[#2a2a3e] text-[#94a3b8] px-2 py-0.5 rounded-full">{sale.tipo_pago}</span>}
                      {sale.coldcaller_nombre && <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full">Setter: {sale.coldcaller_nombre}</span>}
                      {sale.afiliado_email && <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full">Afiliado</span>}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[#C9477A] font-bold">{fmt(Number(sale.cash_collected ?? 0))}</p>
                    <p className="text-xs text-[#4a4a6a] mt-0.5">Cash collected</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-white placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A] transition-colors'

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs text-[#94a3b8] mb-1.5">{label}{required && <span className="text-[#C9477A] ml-0.5">*</span>}</label>
      {children}
    </div>
  )
}
