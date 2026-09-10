'use client'

import { useState, useEffect, useCallback } from 'react'

interface LaunchSale {
  id: number; fecha: string; nombre: string | null; apellido: string | null
  telefono: string | null; email: string | null; plataforma: string | null
  valor: number | null; tipo_pago: string | null; cash_collected: number | null
  closer_id: number | null; closer_nombre?: string
  coldcaller_id: number | null; coldcaller_nombre?: string
  setter_id: number | null; setter_nombre?: string
  lead_email: string | null; afiliado_email: string | null
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null
  utm_content: string | null; utm_term: string | null
  status: 'active' | 'refunded' | null
  nota: string | null
  sheet_row: number | null; created_at: string; updated_at: string
}
interface CloserStat { id: number; nombre: string; ventas: number; cash_collected: number; facturacion: number; pendiente: number; comision: number; comision_actual: number; comision_total: number }
interface CCStatLaunch { id: number; nombre: string; leads: number; reuniones: number; ventas: number; ventas_cobrador?: number; ventas_setter?: number; cash_collected: number; comision: number }
interface AfiliadoStat { email: string; ventas: number; cash_collected: number }
interface UtmRow { value: string; ventas: number; cash_collected: number }
interface Totals {
  reuniones: number; ventas: number; refunded: number;
  facturacion: number; facturacion_refunded: number;
  cash_collected: number; cash_refunded: number; pendiente: number;
  comision_closers: number; comision_closers_total: number; comision_coldcallers: number
}

interface LanzamientoData {
  totals: Totals
  closers: CloserStat[]
  coldcallers: CCStatLaunch[]
  afiliados: AfiliadoStat[]
  sales: LaunchSale[]
  utms: { by_source: UtmRow[]; by_medium: UtmRow[]; by_campaign: UtmRow[] }
}

interface PersonOption { id: number; nombre: string; activa?: boolean }

const PLATAFORMAS = ['Stripe', 'Sequra', 'Transferencia', 'Mixto']
const TIPOS_PAGO = ['Reserva', 'FullPay', '2Pagos', '3Pagos', '4Pagos', 'Sequra6pagos', 'Sequra12pagos']
const EMPTY_NEW_SALE = {
  fecha: '', nombre: '', apellido: '', telefono: '', email: '',
  valor: '', tipo_pago: '', cash_collected: '',
  closer_id: '', setter_id: '', coldcaller_id: '',
  afiliado_email: '', plataforma: '', status: 'active' as 'active' | 'refunded', nota: '',
  utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
}

function fmt(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
}
function fmtFull(n: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n)
}

function KPITile({ label, value, sub, color = 'text-foreground' }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 text-center">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-[#4a4a6a] mt-0.5">{label}</p>
      {sub && <p className="text-xs text-[#4a4a6a] mt-0.5">{sub}</p>}
    </div>
  )
}

export function LanzamientoSection() {
  const [data, setData] = useState<LanzamientoData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [editSale, setEditSale] = useState<LaunchSale | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [editSaving, setEditSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [tab, setTab] = useState<'overview' | 'closers' | 'coldcallers' | 'afiliados' | 'ventas' | 'utms'>('overview')

  // People (closers + cold callers) for selects
  const [people, setPeople] = useState<{ closers: PersonOption[]; coldcallers: PersonOption[] }>({ closers: [], coldcallers: [] })

  // New sale modal state
  const [newOpen, setNewOpen] = useState(false)
  const [newForm, setNewForm] = useState<typeof EMPTY_NEW_SALE>(EMPTY_NEW_SALE)
  const [newSaving, setNewSaving] = useState(false)
  const [newMsg, setNewMsg] = useState('')

  // Persistent diagnostic panel for the last import-batch run
  interface ImportResult {
    total: number
    inserted: number
    updated?: number
    refunded_inserted: number
    deleted_existing?: number
    created_closers?: number
    created_coldcallers?: number
    unmatched_closer: string[]
    unmatched_cobrador: string[]
    unmatched_setter: string[]
    unmatched_lead: string[]
    errors: string[]
    details: { email: string; status: string }[]
  }
  const [lastImport, setLastImport] = useState<ImportResult | null>(null)

  const fetchData = useCallback(async () => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 45_000)
    try {
      const res = await fetch('/api/lanzamiento/admin/stats', { signal: controller.signal, cache: 'no-store' })
      clearTimeout(timeoutId)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const detail = body?.error || (await res.text().catch(() => '')).slice(0, 200)
        setFetchError(`Error ${res.status} al cargar datos de ventas${detail ? ` — ${detail}` : ''}`)
        return
      }
      setData(await res.json())
      setFetchError('')
    } catch (e) {
      clearTimeout(timeoutId)
      const msg = (e as Error).name === 'AbortError'
        ? 'Tiempo de espera agotado (>45s) al cargar datos de ventas'
        : `No se pudo conectar con el servidor: ${(e as Error).message}`
      setFetchError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPeople = useCallback(async () => {
    try {
      const res = await fetch('/api/lanzamiento/admin/closers', { cache: 'no-store' })
      if (res.ok) setPeople(await res.json())
    } catch (e) {
      console.error('Error loading closers/coldcallers list:', e)
    }
  }, [])

  useEffect(() => { fetchData(); fetchPeople() }, [fetchData, fetchPeople])

  async function runSync(endpoint: 'sync-meetings' | 'sync-sales', label: string) {
    setSyncing(true)
    setSyncMsg('')
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 90_000)
    try {
      const res = await fetch(`/api/lanzamiento/admin/${endpoint}`, { method: 'POST', signal: controller.signal })
      clearTimeout(timeoutId)
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        if (endpoint === 'sync-meetings') {
          setSyncMsg(`${label} OK — ${d.synced ?? 0} filas, ${d.matched ?? 0} leads asociados`)
        } else {
          const unmatched: string[] = d.unmatchedCloserNames || []
          const setterUnmatched: string[] = d.unmatchedSetterNames || []
          let msg = `${label} OK — ${d.inserted ?? 0} nuevas, ${d.skipped ?? 0} existían`
          if (d.backfilledSetter) msg += ` · ${d.backfilledSetter} setters re-asignados`
          if (unmatched.length) msg += ` · sin match closer: ${unmatched.slice(0, 5).join(', ')}${unmatched.length > 5 ? '…' : ''}`
          if (setterUnmatched.length) msg += ` · sin match setter: ${setterUnmatched.slice(0, 3).join(', ')}${setterUnmatched.length > 3 ? '…' : ''}`
          setSyncMsg(msg)
        }
        await fetchData()
      } else {
        setSyncMsg(`Error ${res.status} en ${label}${d.error ? ` — ${d.error}` : ''}`)
      }
    } catch (e) {
      clearTimeout(timeoutId)
      const msg = (e as Error).name === 'AbortError'
        ? `${label} agotó el tiempo (>90s). Vuelve a intentarlo.`
        : `Error de red en ${label}: ${(e as Error).message}`
      setSyncMsg(msg)
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(''), 10000)
    }
  }

  const syncMeetings = () => runSync('sync-meetings', 'Sync Reuniones')
  const syncSales    = () => runSync('sync-sales',    'Sync Ventas')

  async function importBatch() {
    if (!confirm('Esto sincroniza el histórico (38 ventas) con la BBDD: las que ya existan se actualizan, las nuevas se insertan. NO borra ninguna otra venta. ¿Continuar?')) return
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await fetch('/api/lanzamiento/admin/import-batch', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        setLastImport(d as ImportResult)
        const processed = (d.inserted ?? 0) + (d.updated ?? 0) + (d.refunded_inserted ?? 0)
        const failed = (d.total ?? 0) - processed
        let msg = `Sync OK — ${d.updated ?? 0} actualizadas, ${d.inserted ?? 0} nuevas, ${d.refunded_inserted ?? 0} devoluciones (${d.total} total)`
        if ((d.created_closers ?? 0) > 0) msg += ` · +${d.created_closers} closers creados`
        if ((d.created_coldcallers ?? 0) > 0) msg += ` · +${d.created_coldcallers} cold callers creados`
        if (failed > 0) msg += ` · ⚠️ ${failed} no procesadas (mira el panel inferior)`
        setSyncMsg(msg)
        await fetchData()
        await fetchPeople()
      } else {
        setSyncMsg(`Error ${res.status} en lote — ${d.error || ''}`)
      }
    } catch (e) {
      setSyncMsg(`Error: ${(e as Error).message}`)
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(''), 30000)
    }
  }

  async function updateCash() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await fetch('/api/lanzamiento/admin/update-cash', { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        let msg = `Cash actualizado — ${d.updated}/${d.total} ventas`
        if (d.not_found?.length) msg += ` · sin match: ${d.not_found.join(', ')}`
        setSyncMsg(msg)
        await fetchData()
      } else {
        setSyncMsg(`Error ${res.status} en update-cash — ${d.error || ''}`)
      }
    } catch (e) {
      setSyncMsg(`Error: ${(e as Error).message}`)
    } finally {
      setSyncing(false)
      setTimeout(() => setSyncMsg(''), 12000)
    }
  }

  function openEdit(sale: LaunchSale) {
    setEditSale(sale)
    setEditForm({
      fecha: sale.fecha || '',
      nombre: sale.nombre || '',
      apellido: sale.apellido || '',
      telefono: sale.telefono || '',
      email: sale.email || '',
      closer_id: sale.closer_id ? String(sale.closer_id) : '',
      setter_id: sale.setter_id ? String(sale.setter_id) : '',
      coldcaller_id: sale.coldcaller_id ? String(sale.coldcaller_id) : '',
      afiliado_email: sale.afiliado_email || '',
      plataforma: sale.plataforma || '',
      tipo_pago: sale.tipo_pago || '',
      cash_collected: sale.cash_collected != null ? String(sale.cash_collected) : '',
      valor: sale.valor != null ? String(sale.valor) : '',
      status: sale.status || 'active',
      nota: sale.nota || '',
      utm_source: sale.utm_source || '',
      utm_medium: sale.utm_medium || '',
      utm_campaign: sale.utm_campaign || '',
      utm_content: sale.utm_content || '',
      utm_term: sale.utm_term || '',
    })
  }

  async function confirmDelete(id: number) {
    setDeleting(true)
    await fetch(`/api/lanzamiento/admin/sales/${id}`, { method: 'DELETE' })
    setDeleting(false)
    setConfirmDeleteId(null)
    fetchData()
  }

  async function saveEdit() {
    if (!editSale) return
    setEditSaving(true)

    // Send only fields that changed (or were cleared)
    const payload: Record<string, string | number | null> = {}
    const setStr = (key: keyof LaunchSale, val: string) => {
      const cur = (editSale[key] as string | null) ?? ''
      if (val !== cur) payload[key] = val === '' ? null : val
    }
    const setNum = (key: keyof LaunchSale, val: string) => {
      const cur = editSale[key] != null ? String(editSale[key]) : ''
      if (val !== cur) payload[key] = val === '' ? null : Number(val)
    }
    const setIntNullable = (key: keyof LaunchSale, val: string) => {
      const cur = editSale[key] != null ? String(editSale[key]) : ''
      if (val !== cur) payload[key] = val === '' ? null : Number(val)
    }

    setStr('fecha', editForm.fecha)
    setStr('nombre', editForm.nombre)
    setStr('apellido', editForm.apellido)
    setStr('telefono', editForm.telefono)
    setStr('email', editForm.email)
    setIntNullable('closer_id', editForm.closer_id)
    setIntNullable('setter_id', editForm.setter_id)
    setIntNullable('coldcaller_id', editForm.coldcaller_id)
    setStr('afiliado_email', editForm.afiliado_email)
    setStr('plataforma', editForm.plataforma)
    setStr('tipo_pago', editForm.tipo_pago)
    setNum('cash_collected', editForm.cash_collected)
    setNum('valor', editForm.valor)
    setStr('status', editForm.status)
    setStr('nota', editForm.nota)
    setStr('utm_source', editForm.utm_source)
    setStr('utm_medium', editForm.utm_medium)
    setStr('utm_campaign', editForm.utm_campaign)
    setStr('utm_content', editForm.utm_content)
    setStr('utm_term', editForm.utm_term)

    await fetch(`/api/lanzamiento/admin/sales/${editSale.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setEditSaving(false)
    setEditSale(null)
    fetchData()
  }

  function openNew() {
    const today = new Date().toISOString().split('T')[0]
    setNewForm({ ...EMPTY_NEW_SALE, fecha: today })
    setNewMsg('')
    setNewOpen(true)
  }

  async function saveNew() {
    if (!newForm.email || !newForm.fecha || !newForm.closer_id || !newForm.tipo_pago) {
      setNewMsg('Faltan campos obligatorios: email, fecha, closer y tipo de pago')
      return
    }
    setNewSaving(true)
    setNewMsg('')
    const payload = {
      fecha: newForm.fecha,
      nombre: newForm.nombre,
      apellido: newForm.apellido,
      telefono: newForm.telefono || null,
      email: newForm.email,
      valor: newForm.valor ? Number(newForm.valor) : 0,
      tipo_pago: newForm.tipo_pago,
      cash_collected: newForm.cash_collected ? Number(newForm.cash_collected) : 0,
      closer_id: Number(newForm.closer_id),
      setter_id: newForm.setter_id ? Number(newForm.setter_id) : null,
      coldcaller_id: newForm.coldcaller_id ? Number(newForm.coldcaller_id) : null,
      afiliado_email: newForm.afiliado_email || null,
      plataforma: newForm.plataforma || null,
      status: newForm.status,
      nota: newForm.nota || null,
      utm_source: newForm.utm_source || undefined,
      utm_medium: newForm.utm_medium || undefined,
      utm_campaign: newForm.utm_campaign || undefined,
      utm_content: newForm.utm_content || undefined,
      utm_term: newForm.utm_term || undefined,
    }
    try {
      const res = await fetch('/api/lanzamiento/admin/sales/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNewMsg(`Error ${res.status}: ${d.error || 'desconocido'}`)
      } else {
        setNewMsg(d.lead_matched
          ? '✓ Venta creada. UTMs auto-completadas desde leads_cache.'
          : '✓ Venta creada. (Email no encontrado en leads_cache — UTMs vacías; puedes editarlas)')
        await fetchData()
        setTimeout(() => { setNewOpen(false); setNewMsg('') }, 1400)
      }
    } catch (e) {
      setNewMsg(`Error: ${(e as Error).message}`)
    } finally {
      setNewSaving(false)
    }
  }

  const t = data?.totals ?? { reuniones: 0, ventas: 0, refunded: 0, facturacion: 0, facturacion_refunded: 0, cash_collected: 0, cash_refunded: 0, pendiente: 0, comision_closers: 0, comision_closers_total: 0, comision_coldcallers: 0 }
  const closersList = data?.closers ?? []
  const coldcallersList = data?.coldcallers ?? []
  const afiliadosList = data?.afiliados ?? []
  const salesList = data?.sales ?? []
  const utms = data?.utms ?? { by_source: [], by_medium: [], by_campaign: [] }

  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#C9477A]/20 border border-[#C9477A]/30 flex items-center justify-center">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C9477A" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <h2 className="text-foreground font-bold text-base">Ventas Lanzamiento</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {syncMsg && <span className="text-xs text-emerald-400">{syncMsg}</span>}
          <button onClick={openNew}
            className="px-3 py-1.5 bg-[#C9477A] hover:bg-[#b03868] text-foreground rounded-xl text-xs transition-colors font-semibold">
            + Nueva Venta
          </button>
          <button onClick={syncMeetings} disabled={syncing}
            className="px-3 py-1.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] disabled:opacity-50 text-[#94a3b8] rounded-xl text-xs transition-colors border border-[#3a3a5e]">
            {syncing ? 'Sincronizando...' : 'Sync Reuniones'}
          </button>
          <button onClick={syncSales} disabled={syncing}
            className="px-3 py-1.5 bg-[#C9477A]/10 hover:bg-[#C9477A]/20 disabled:opacity-50 text-[#C9477A] rounded-xl text-xs transition-colors border border-[#C9477A]/30">
            {syncing ? 'Sincronizando...' : 'Sync Ventas'}
          </button>
          <button onClick={updateCash} disabled={syncing}
            title="Sólo actualiza cash_collected de las 6 ventas con cambio (no toca nada más)"
            className="px-3 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 disabled:opacity-50 text-yellow-400 rounded-xl text-xs transition-colors border border-yellow-500/30">
            Actualizar cash (6)
          </button>
          <button onClick={importBatch} disabled={syncing}
            title="Sincroniza el histórico (38): actualiza las que ya existen por email, inserta las nuevas. No borra el resto. Auto-crea closers/cold_callers que falten."
            className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 text-emerald-400 rounded-xl text-xs transition-colors border border-emerald-500/30">
            Sincronizar histórico (38)
          </button>
        </div>
      </div>

      {/* Status banner */}
      {loading && (
        <div className="text-xs text-[#94a3b8] animate-pulse">Cargando datos…</div>
      )}
      {fetchError && (
        <div className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
          <p className="text-xs text-red-400">{fetchError}</p>
          <button onClick={fetchData} className="text-xs text-[#94a3b8] hover:text-foreground px-2 py-1 rounded-lg bg-[#2a2a3e]">Reintentar</button>
        </div>
      )}

      {/* Closers / Cold callers reference (for debugging name mismatches) */}
      {lastImport && lastImport.unmatched_closer.length > 0 && (
        <div className="bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl p-3 space-y-2">
          <p className="text-xs text-[#94a3b8] font-semibold">📋 Closers actualmente en launch_closers (compara con los que fallan):</p>
          <p className="text-xs text-foreground">{people.closers.map(p => p.nombre).join(' · ') || '(vacío)'}</p>
        </div>
      )}

      {/* Last import diagnostic panel */}
      {lastImport && (() => {
        const processed = lastImport.inserted + (lastImport.updated ?? 0) + lastImport.refunded_inserted
        const failed = lastImport.total - processed
        const failedDetails = lastImport.details.filter(d => d.status.startsWith('closer_sin_match') || d.status.startsWith('error'))
        return (
          <div className={`bg-[#1a1a2e] border rounded-xl p-3 space-y-2 ${failed > 0 ? 'border-amber-500/40' : 'border-emerald-500/40'}`}>
            <div className="flex items-center justify-between">
              <p className={`text-xs font-semibold ${failed > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                Último sync: {processed}/{lastImport.total} procesadas
                {(lastImport.updated ?? 0) > 0 && ` · ${lastImport.updated} actualizadas`}
                {lastImport.inserted > 0 && ` · ${lastImport.inserted} nuevas`}
                {lastImport.refunded_inserted > 0 && ` · ${lastImport.refunded_inserted} devoluciones`}
                {(lastImport.created_closers ?? 0) > 0 && ` · +${lastImport.created_closers} closer(s) auto-creados`}
                {(lastImport.created_coldcallers ?? 0) > 0 && ` · +${lastImport.created_coldcallers} cold caller(s) auto-creados`}
                {failed > 0 && ` · ⚠️ ${failed} fallaron`}
              </p>
              <button onClick={() => setLastImport(null)} className="text-xs text-[#4a4a6a] hover:text-[#94a3b8]">cerrar</button>
            </div>
            {lastImport.unmatched_closer.length > 0 && (
              <div className="text-xs">
                <span className="text-red-400 font-semibold">Closer sin match en launch_closers:</span>{' '}
                <span className="text-[#94a3b8]">{Array.from(new Set(lastImport.unmatched_closer)).join(', ')}</span>
                <span className="text-[#4a4a6a] ml-2">({lastImport.unmatched_closer.length} ventas omitidas)</span>
              </div>
            )}
            {lastImport.unmatched_cobrador.length > 0 && (
              <div className="text-xs">
                <span className="text-amber-400 font-semibold">Cobrador sin match (venta sí insertada, pero sin coldcaller):</span>{' '}
                <span className="text-[#94a3b8]">{Array.from(new Set(lastImport.unmatched_cobrador)).join(', ')}</span>
              </div>
            )}
            {lastImport.unmatched_setter.length > 0 && (
              <div className="text-xs">
                <span className="text-amber-400 font-semibold">Setter sin match:</span>{' '}
                <span className="text-[#94a3b8]">{Array.from(new Set(lastImport.unmatched_setter)).join(', ')}</span>
              </div>
            )}
            {lastImport.unmatched_lead.length > 0 && (
              <div className="text-xs">
                <span className="text-blue-400 font-semibold">Sin match en leads_cache (UTMs vacías):</span>{' '}
                <span className="text-[#94a3b8]">{lastImport.unmatched_lead.length} emails</span>
              </div>
            )}
            {failedDetails.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-[#94a3b8] hover:text-foreground">Ver emails de las {failedDetails.length} ventas no insertadas</summary>
                <ul className="mt-1.5 space-y-0.5 pl-3">
                  {failedDetails.map((d, i) => (
                    <li key={i} className="text-[#94a3b8]">
                      <span className="text-red-400">{d.email}</span> — {d.status}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )
      })()}

      {/* Totals — top row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPITile label="Reuniones" value={t.reuniones} color="text-blue-400" />
        <KPITile
          label="Ventas activas"
          value={t.ventas}
          sub={t.refunded > 0 ? `+ ${t.refunded} devoluciones` : undefined}
          color="text-emerald-400"
        />
        <KPITile label="Facturación" sub="lo vendido (sin devoluciones)" value={fmt(t.facturacion)} color="text-[#C9477A]" />
        <KPITile label="Cash Collected" sub={`Pendiente: ${fmt(t.pendiente)}`} value={fmt(t.cash_collected)} color="text-emerald-300" />
      </div>
      {/* Devoluciones (solo si hay) */}
      {t.refunded > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KPITile label="Devoluciones" sub="ventas marcadas como reembolso" value={t.refunded} color="text-red-400" />
          <KPITile label="Cash devuelto" sub={`Facturación devuelta: ${fmt(t.facturacion_refunded)}`} value={fmt(t.cash_refunded)} color="text-red-400" />
        </div>
      )}
      {/* Totals — comisiones */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPITile label="Comis. Closers (actual)"  sub="8% del cash collected · sin devoluciones" value={fmt(t.comision_closers)} color="text-yellow-400" />
        <KPITile label="Comis. Closers (al cobrar todo)" sub="8% de la facturación · sin devoluciones" value={fmt(t.comision_closers_total)} color="text-yellow-200" />
        <KPITile label="Comis. Cold Callers" sub="70/80/100€ por venta (setter+cobrador, sin devoluciones)" value={fmt(t.comision_coldcallers)} color="text-yellow-400" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#1a1a2e] border border-[#2a2a3e] rounded-xl p-1 w-fit flex-wrap">
        {(['overview', 'closers', 'coldcallers', 'afiliados', 'ventas', 'utms'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tab === t ? 'bg-[#C9477A] text-foreground' : 'text-[#4a4a6a] hover:text-[#94a3b8]'}`}>
            {t === 'overview' ? 'Resumen' : t === 'closers' ? 'Closers' : t === 'coldcallers' ? 'Cold Callers' : t === 'afiliados' ? 'Afiliados' : t === 'ventas' ? 'Ventas' : 'UTMs'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'closers' && (
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="border-b border-[#2a2a3e]">
                {['Closer', 'Ventas', 'Facturación', 'Cash Collected', 'Pendiente', 'Com. Actual (8% cash)', 'Com. Total (8% fact.)'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-[#4a4a6a] font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {closersList.map(c => (
                <tr key={c.id} className="border-b border-[#2a2a3e] last:border-0">
                  <td className="px-4 py-3 text-foreground font-medium">{c.nombre}</td>
                  <td className="px-4 py-3 text-emerald-400 font-semibold">{c.ventas}</td>
                  <td className="px-4 py-3 text-[#C9477A] font-semibold">{fmt(c.facturacion)}</td>
                  <td className="px-4 py-3 text-emerald-300 font-semibold">{fmt(c.cash_collected)}</td>
                  <td className="px-4 py-3 text-orange-300">{fmt(c.pendiente)}</td>
                  <td className="px-4 py-3 text-yellow-400 font-semibold">{fmtFull(c.comision_actual)}</td>
                  <td className="px-4 py-3 text-yellow-200 font-semibold">{fmtFull(c.comision_total)}</td>
                </tr>
              ))}
              {closersList.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-[#4a4a6a] text-xs">Sin ventas registradas</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'coldcallers' && (
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a3e]">
                {['Cold Caller', 'Leads', 'Reuniones', 'V. cobrador', 'V. setter', 'Ventas tot.', 'Facturado', 'Comisión'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-[#4a4a6a] font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coldcallersList.map(c => (
                <tr key={c.id} className="border-b border-[#2a2a3e] last:border-0">
                  <td className="px-4 py-3 text-foreground font-medium">{c.nombre}</td>
                  <td className="px-4 py-3 text-[#94a3b8]">{c.leads}</td>
                  <td className="px-4 py-3 text-blue-400 font-semibold">{c.reuniones}</td>
                  <td className="px-4 py-3 text-purple-400 font-semibold">{c.ventas_cobrador ?? 0}</td>
                  <td className="px-4 py-3 text-pink-400 font-semibold">{c.ventas_setter ?? 0}</td>
                  <td className="px-4 py-3 text-emerald-400 font-semibold">{c.ventas}</td>
                  <td className="px-4 py-3 text-[#C9477A] font-semibold">{fmt(c.cash_collected)}</td>
                  <td className="px-4 py-3 text-yellow-400 font-semibold">{fmtFull(c.comision)}</td>
                </tr>
              ))}
              {coldcallersList.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-[#4a4a6a] text-xs">Sin datos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'afiliados' && (
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a2a3e]">
                {['Afiliado', 'Ventas', 'Facturado'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-[#4a4a6a] font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {afiliadosList.map(a => (
                <tr key={a.email} className="border-b border-[#2a2a3e] last:border-0">
                  <td className="px-4 py-3 text-foreground font-medium">{a.email}</td>
                  <td className="px-4 py-3 text-emerald-400 font-semibold">{a.ventas}</td>
                  <td className="px-4 py-3 text-[#C9477A] font-semibold">{fmt(a.cash_collected)}</td>
                </tr>
              ))}
              {afiliadosList.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-[#4a4a6a] text-xs">Sin ventas de afiliados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'ventas' && (
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-[#2a2a3e]">
                  {['Fecha', 'Nombre', 'Email', 'Tipo Pago', 'Cash', 'Closer', 'Setter', 'Cobrador', 'UTM Source', 'Estado', ''].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs text-[#4a4a6a] font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {salesList.map(s => {
                  const isRefund = s.status === 'refunded'
                  return (
                    <tr key={s.id} className={`border-b border-[#2a2a3e] last:border-0 hover:bg-[#2a2a3e]/30 ${isRefund ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-3 text-[#94a3b8] text-xs whitespace-nowrap">{s.fecha ? new Date(s.fecha).toLocaleDateString('es-ES') : '—'}</td>
                      <td className="px-3 py-3 text-foreground font-medium whitespace-nowrap">{[s.nombre, s.apellido].filter(Boolean).join(' ') || '—'}</td>
                      <td className="px-3 py-3 text-[#4a4a6a] text-xs">{s.email || '—'}</td>
                      <td className="px-3 py-3 text-[#94a3b8] text-xs">{s.tipo_pago || '—'}</td>
                      <td className="px-3 py-3 text-[#C9477A] font-semibold whitespace-nowrap">{fmt(Number(s.cash_collected ?? 0))}</td>
                      <td className="px-3 py-3 text-[#94a3b8] text-xs whitespace-nowrap">{s.closer_nombre || '—'}</td>
                      <td className="px-3 py-3 text-pink-300 text-xs whitespace-nowrap">{s.setter_nombre || '—'}</td>
                      <td className="px-3 py-3 text-purple-300 text-xs whitespace-nowrap">{s.coldcaller_nombre || '—'}</td>
                      <td className="px-3 py-3 text-blue-300 text-xs whitespace-nowrap">{s.utm_source || '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {isRefund ? (
                          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-red-500/15 text-red-400 border border-red-500/30 font-semibold">Devuelta</span>
                        ) : (
                          <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Activa</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(s)} className="text-xs text-[#4a4a6a] hover:text-[#C9477A] transition-colors">Editar</button>
                          {confirmDeleteId === s.id ? (
                            <span className="flex items-center gap-1">
                              <button onClick={() => confirmDelete(s.id)} disabled={deleting}
                                className="text-xs text-red-400 hover:text-red-300 font-semibold disabled:opacity-50 transition-colors">
                                {deleting ? '...' : 'Confirmar'}
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-[#4a4a6a] hover:text-[#94a3b8] transition-colors">Cancelar</button>
                            </span>
                          ) : (
                            <button onClick={() => setConfirmDeleteId(s.id)} className="text-xs text-[#4a4a6a] hover:text-red-400 transition-colors">Borrar</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {salesList.length === 0 && (
                  <tr><td colSpan={11} className="px-4 py-6 text-center text-[#4a4a6a] text-xs">Sin ventas registradas</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'utms' && (
        <div className="space-y-4">
          {[
            { title: 'Por Source', rows: utms.by_source },
            { title: 'Por Medium', rows: utms.by_medium },
            { title: 'Por Campaign', rows: utms.by_campaign },
          ].map(({ title, rows }) => (
            <div key={title} className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl overflow-hidden">
              <p className="text-xs text-[#94a3b8] font-medium uppercase tracking-wider px-4 py-3 border-b border-[#2a2a3e]">{title}</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#2a2a3e]">
                    {['Valor', 'Ventas', 'Cash Collected'].map(h => (
                      <th key={h} className="text-left px-4 py-2 text-xs text-[#4a4a6a] font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.value} className="border-b border-[#2a2a3e] last:border-0">
                      <td className="px-4 py-2.5 text-foreground font-medium text-xs">{r.value}</td>
                      <td className="px-4 py-2.5 text-emerald-400 font-semibold text-xs">{r.ventas}</td>
                      <td className="px-4 py-2.5 text-[#C9477A] font-semibold text-xs">{fmt(r.cash_collected)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-4 text-center text-[#4a4a6a] text-xs">Sin datos</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {tab === 'overview' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Closers mini */}
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 space-y-3">
            <p className="text-xs text-[#94a3b8] font-medium uppercase tracking-wider">Top Closers</p>
            {closersList.slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{c.nombre}</span>
                <div className="text-right">
                  <span className="text-[#C9477A] text-sm font-semibold">{fmt(c.cash_collected)}</span>
                  <span className="text-[#4a4a6a] text-xs ml-2">({c.ventas}v)</span>
                </div>
              </div>
            ))}
            {closersList.length === 0 && <p className="text-[#4a4a6a] text-xs">Sin datos</p>}
          </div>
          {/* Cold callers mini */}
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 space-y-3">
            <p className="text-xs text-[#94a3b8] font-medium uppercase tracking-wider">Top Cold Callers</p>
            {coldcallersList.filter(c => c.ventas > 0).slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{c.nombre}</span>
                <div className="text-right">
                  <span className="text-[#C9477A] text-sm font-semibold">{fmt(c.cash_collected)}</span>
                  <span className="text-[#4a4a6a] text-xs ml-2">{c.reuniones}r · {c.ventas}v</span>
                </div>
              </div>
            ))}
            {coldcallersList.filter(c => c.ventas > 0).length === 0 && <p className="text-[#4a4a6a] text-xs">Sin ventas aún</p>}
          </div>
        </div>
      )}

      {/* New Sale modal */}
      {newOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => !newSaving && setNewOpen(false)}>
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-3xl w-full max-w-2xl p-6 space-y-4 my-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-bold">Nueva venta</h3>
              <span className="text-xs text-[#4a4a6a]">UTMs se auto-rellenan al guardar (lookup en leads_cache por email)</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <EditField label="Fecha *">
                <input type="date" value={newForm.fecha} onChange={e => setNewForm(f => ({ ...f, fecha: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Email *">
                <input type="email" value={newForm.email} onChange={e => setNewForm(f => ({ ...f, email: e.target.value }))} placeholder="cliente@email.com" className={eCls} />
              </EditField>
              <EditField label="Teléfono">
                <input value={newForm.telefono} onChange={e => setNewForm(f => ({ ...f, telefono: e.target.value }))} placeholder="+34 600 00 00 00" className={eCls} />
              </EditField>
              <EditField label="Nombre">
                <input value={newForm.nombre} onChange={e => setNewForm(f => ({ ...f, nombre: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Apellido">
                <input value={newForm.apellido} onChange={e => setNewForm(f => ({ ...f, apellido: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Plataforma">
                <select value={newForm.plataforma} onChange={e => setNewForm(f => ({ ...f, plataforma: e.target.value }))} className={eCls}>
                  <option value="">—</option>
                  {PLATAFORMAS.map(p => <option key={p}>{p}</option>)}
                </select>
              </EditField>
              <EditField label="Tipo de Pago *">
                <select value={newForm.tipo_pago} onChange={e => setNewForm(f => ({ ...f, tipo_pago: e.target.value }))} className={eCls}>
                  <option value="">—</option>
                  {TIPOS_PAGO.map(p => <option key={p}>{p}</option>)}
                </select>
              </EditField>
              <EditField label="Valor (€)">
                <input type="number" step="0.01" value={newForm.valor} onChange={e => setNewForm(f => ({ ...f, valor: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Cash Collected (€)">
                <input type="number" step="0.01" value={newForm.cash_collected} onChange={e => setNewForm(f => ({ ...f, cash_collected: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Closer *">
                <select value={newForm.closer_id} onChange={e => setNewForm(f => ({ ...f, closer_id: e.target.value }))} className={eCls}>
                  <option value="">—</option>
                  {people.closers.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </EditField>
              <EditField label="Setter">
                <select value={newForm.setter_id} onChange={e => setNewForm(f => ({ ...f, setter_id: e.target.value }))} className={eCls}>
                  <option value="">—</option>
                  {people.coldcallers.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </EditField>
              <EditField label="Cobrador">
                <select value={newForm.coldcaller_id} onChange={e => setNewForm(f => ({ ...f, coldcaller_id: e.target.value }))} className={eCls}>
                  <option value="">—</option>
                  {people.coldcallers.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </EditField>
              <EditField label="Afiliado (email)">
                <input value={newForm.afiliado_email} onChange={e => setNewForm(f => ({ ...f, afiliado_email: e.target.value }))} placeholder="afiliada@email.com" className={eCls} />
              </EditField>
              <EditField label="Estado">
                <select value={newForm.status} onChange={e => setNewForm(f => ({ ...f, status: e.target.value as 'active' | 'refunded' }))} className={eCls}>
                  <option value="active">Activa</option>
                  <option value="refunded">Devuelta</option>
                </select>
              </EditField>
              <EditField label="Nota">
                <input value={newForm.nota} onChange={e => setNewForm(f => ({ ...f, nota: e.target.value }))} placeholder="Observaciones" className={eCls} />
              </EditField>
            </div>

            {/* UTM overrides */}
            <details className="bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl p-3">
              <summary className="text-xs text-[#94a3b8] cursor-pointer">Sobreescribir UTMs (opcional — si está vacío, se rellena desde leads_cache)</summary>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                <EditField label="utm_source"><input value={newForm.utm_source} onChange={e => setNewForm(f => ({ ...f, utm_source: e.target.value }))} className={eCls} /></EditField>
                <EditField label="utm_medium"><input value={newForm.utm_medium} onChange={e => setNewForm(f => ({ ...f, utm_medium: e.target.value }))} className={eCls} /></EditField>
                <EditField label="utm_campaign"><input value={newForm.utm_campaign} onChange={e => setNewForm(f => ({ ...f, utm_campaign: e.target.value }))} className={eCls} /></EditField>
                <EditField label="utm_content"><input value={newForm.utm_content} onChange={e => setNewForm(f => ({ ...f, utm_content: e.target.value }))} className={eCls} /></EditField>
                <EditField label="utm_term"><input value={newForm.utm_term} onChange={e => setNewForm(f => ({ ...f, utm_term: e.target.value }))} className={eCls} /></EditField>
              </div>
            </details>

            {newMsg && <div className={`text-xs px-3 py-2 rounded-xl ${newMsg.startsWith('✓') ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/10 text-red-400 border border-red-500/30'}`}>{newMsg}</div>}

            <div className="flex gap-3 pt-1">
              <button onClick={() => setNewOpen(false)} disabled={newSaving} className="flex-1 py-2.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#94a3b8] rounded-xl text-sm transition-colors disabled:opacity-50">Cancelar</button>
              <button onClick={saveNew} disabled={newSaving} className="flex-1 py-2.5 bg-[#C9477A] hover:bg-[#b03868] disabled:opacity-50 text-foreground font-semibold rounded-xl text-sm transition-colors">
                {newSaving ? 'Guardando...' : 'Crear venta'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editSale && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setEditSale(null)}>
          <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-3xl w-full max-w-2xl p-6 space-y-4 my-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-bold">Editar venta</h3>
              <span className="text-xs text-[#4a4a6a]">{[editSale.nombre, editSale.apellido].filter(Boolean).join(' ') || editSale.email}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <EditField label="Fecha">
                <input type="date" value={editForm.fecha} onChange={e => setEditForm(p => ({ ...p, fecha: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Email">
                <input type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Teléfono">
                <input value={editForm.telefono} onChange={e => setEditForm(p => ({ ...p, telefono: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Nombre">
                <input value={editForm.nombre} onChange={e => setEditForm(p => ({ ...p, nombre: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Apellido">
                <input value={editForm.apellido} onChange={e => setEditForm(p => ({ ...p, apellido: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Estado">
                <select value={editForm.status} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))} className={eCls}>
                  <option value="active">Activa</option>
                  <option value="refunded">Devuelta</option>
                </select>
              </EditField>
              <EditField label="Plataforma">
                <select value={editForm.plataforma} onChange={e => setEditForm(p => ({ ...p, plataforma: e.target.value }))} className={eCls}>
                  <option value="">—</option>
                  {PLATAFORMAS.map(p => <option key={p}>{p}</option>)}
                </select>
              </EditField>
              <EditField label="Tipo de Pago">
                <select value={editForm.tipo_pago} onChange={e => setEditForm(p => ({ ...p, tipo_pago: e.target.value }))} className={eCls}>
                  <option value="">—</option>
                  {TIPOS_PAGO.map(t => <option key={t}>{t}</option>)}
                </select>
              </EditField>
              <EditField label="Valor (€)">
                <input type="number" step="0.01" value={editForm.valor} onChange={e => setEditForm(p => ({ ...p, valor: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Cash Collected (€)">
                <input type="number" step="0.01" value={editForm.cash_collected} onChange={e => setEditForm(p => ({ ...p, cash_collected: e.target.value }))} className={eCls} />
              </EditField>
              <EditField label="Closer">
                <select value={editForm.closer_id} onChange={e => setEditForm(p => ({ ...p, closer_id: e.target.value }))} className={eCls}>
                  <option value="">—</option>
                  {people.closers.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </EditField>
              <EditField label="Setter">
                <select value={editForm.setter_id} onChange={e => setEditForm(p => ({ ...p, setter_id: e.target.value }))} className={eCls}>
                  <option value="">—</option>
                  {people.coldcallers.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </EditField>
              <EditField label="Cobrador">
                <select value={editForm.coldcaller_id} onChange={e => setEditForm(p => ({ ...p, coldcaller_id: e.target.value }))} className={eCls}>
                  <option value="">—</option>
                  {people.coldcallers.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </EditField>
              <EditField label="Afiliado (email)">
                <input value={editForm.afiliado_email} onChange={e => setEditForm(p => ({ ...p, afiliado_email: e.target.value }))} placeholder="afiliada@email.com" className={eCls} />
              </EditField>
              <EditField label="Nota">
                <input value={editForm.nota} onChange={e => setEditForm(p => ({ ...p, nota: e.target.value }))} placeholder="Observaciones" className={eCls} />
              </EditField>
            </div>

            {/* UTM section */}
            <details className="bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl p-3" open={!!(editSale.utm_source || editSale.utm_medium || editSale.utm_campaign)}>
              <summary className="text-xs text-[#94a3b8] cursor-pointer">UTMs (procedencia del lead)</summary>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
                <EditField label="utm_source"><input value={editForm.utm_source} onChange={e => setEditForm(p => ({ ...p, utm_source: e.target.value }))} className={eCls} /></EditField>
                <EditField label="utm_medium"><input value={editForm.utm_medium} onChange={e => setEditForm(p => ({ ...p, utm_medium: e.target.value }))} className={eCls} /></EditField>
                <EditField label="utm_campaign"><input value={editForm.utm_campaign} onChange={e => setEditForm(p => ({ ...p, utm_campaign: e.target.value }))} className={eCls} /></EditField>
                <EditField label="utm_content"><input value={editForm.utm_content} onChange={e => setEditForm(p => ({ ...p, utm_content: e.target.value }))} className={eCls} /></EditField>
                <EditField label="utm_term"><input value={editForm.utm_term} onChange={e => setEditForm(p => ({ ...p, utm_term: e.target.value }))} className={eCls} /></EditField>
              </div>
            </details>

            <div className="flex gap-3 pt-1">
              <button onClick={() => setEditSale(null)} className="flex-1 py-2.5 bg-[#2a2a3e] hover:bg-[#3a3a5e] text-[#94a3b8] rounded-xl text-sm transition-colors">Cancelar</button>
              <button onClick={saveEdit} disabled={editSaving} className="flex-1 py-2.5 bg-[#C9477A] hover:bg-[#b03868] disabled:opacity-50 text-foreground font-semibold rounded-xl text-sm transition-colors">
                {editSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

const eCls = 'w-full px-3 py-2 bg-[#0f0f1a] border border-[#2a2a3e] rounded-xl text-foreground placeholder-[#4a4a6a] text-sm focus:outline-none focus:border-[#C9477A] transition-colors'

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-[#94a3b8] mb-1.5">{label}</label>
      {children}
    </div>
  )
}
