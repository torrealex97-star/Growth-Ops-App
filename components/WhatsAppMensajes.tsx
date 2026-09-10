'use client'

import type { WhatsAppMsgStats } from '@/lib/types'

interface Props {
  stats: WhatsAppMsgStats | null
  loading?: boolean
}

function Skeleton() {
  return <div className="h-24 rounded-2xl bg-[#1a1a2e] border border-[#2a2a3e] animate-pulse" />
}

function rateColor(pct: number) {
  if (pct >= 80) return { text: 'text-emerald-400', bar: '#10b981', border: 'border-emerald-500/20', bg: 'bg-emerald-500/10' }
  if (pct >= 50) return { text: 'text-yellow-400', bar: '#eab308', border: 'border-yellow-500/20', bg: 'bg-yellow-500/10' }
  return { text: 'text-red-400', bar: '#ef4444', border: 'border-red-500/20', bg: 'bg-red-500/10' }
}

export function WhatsAppMensajes({ stats, loading = false }: Props) {
  if (loading) {
    return (
      <section>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-1 h-6 bg-[#25d366] rounded-full" />
          <h2 className="text-lg font-bold text-foreground">WhatsApp Mensajes</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2].map(i => <Skeleton key={i} />)}
        </div>
      </section>
    )
  }

  if (!stats) return null

  const entrega = rateColor(stats.tasaEntrega)
  const interaccion = rateColor(stats.tasaInteraccion)

  return (
    <section>
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1 h-6 bg-[#25d366] rounded-full" />
        <h2 className="text-lg font-bold text-foreground">WhatsApp Mensajes</h2>
        <span className="text-xs text-[#4a4a6a] bg-[#2a2a3e] px-2 py-0.5 rounded-full">
          WhatsApp Registro
        </span>
      </div>

      {/* ROW 1: 4 KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">

        {/* Enviados — sent + interacted */}
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#25d366]/10 border border-[#25d366]/20 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#25d366">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{stats.enviados.toLocaleString('es-ES')}</p>
            <p className="text-xs text-[#4a4a6a]">Enviados</p>
            <p className="text-xs text-[#25d366]/60">Interactuaron</p>
          </div>
        </div>

        {/* Timeout — sent but no interaction */}
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{stats.timeout.toLocaleString('es-ES')}</p>
            <p className="text-xs text-[#4a4a6a]">Timeout</p>
            <p className="text-xs text-orange-400/60">Sin interacción</p>
          </div>
        </div>

        {/* Fallidos — failed to send */}
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{stats.fallidos.toLocaleString('es-ES')}</p>
            <p className="text-xs text-[#4a4a6a]">Fallidos</p>
            <p className="text-xs text-red-400/60">No entregado</p>
          </div>
        </div>

        {/* Sin contactar */}
        <div className="bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#4a4a6a]/20 border border-[#4a4a6a]/30 flex items-center justify-center flex-shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{stats.pendientes.toLocaleString('es-ES')}</p>
            <p className="text-xs text-[#4a4a6a]">Sin contactar</p>
            <p className="text-xs text-[#4a4a6a]/60">Pendientes</p>
          </div>
        </div>
      </div>

      {/* ROW 2: Rate bars */}
      {stats.totalContactados > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Tasa de entrega */}
          <div className={`bg-[#1a1a2e] border rounded-2xl p-4 ${stats.totalEntregados > 0 ? `${entrega.bg} ${entrega.border}` : 'border-[#2a2a3e]'}`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-foreground font-medium">Tasa de entrega</p>
              <span className={`text-xl font-bold ${stats.totalEntregados > 0 ? entrega.text : 'text-[#4a4a6a]'}`}>
                {stats.totalContactados > 0 ? `${stats.tasaEntrega}%` : '—'}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[#2a2a3e] overflow-hidden mt-2">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${stats.tasaEntrega}%`, background: entrega.bar }}
              />
            </div>
            <p className="text-xs text-[#4a4a6a] mt-2">
              {stats.totalEntregados} entregados de {stats.totalContactados} intentos
              <span className="text-[#4a4a6a]/60"> (enviados + timeout vs fallidos)</span>
            </p>
          </div>

          {/* Tasa de interacción */}
          <div className={`bg-[#1a1a2e] border rounded-2xl p-4 ${stats.totalEntregados > 0 ? `${interaccion.bg} ${interaccion.border}` : 'border-[#2a2a3e]'}`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm text-foreground font-medium">Tasa de interacción</p>
              <span className={`text-xl font-bold ${stats.totalEntregados > 0 ? interaccion.text : 'text-[#4a4a6a]'}`}>
                {stats.totalEntregados > 0 ? `${stats.tasaInteraccion}%` : '—'}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-[#2a2a3e] overflow-hidden mt-2">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${stats.tasaInteraccion}%`, background: interaccion.bar }}
              />
            </div>
            <p className="text-xs text-[#4a4a6a] mt-2">
              {stats.enviados} interactuaron de {stats.totalEntregados} entregados
              <span className="text-[#4a4a6a]/60"> (ignoraron el mensaje: {stats.timeout})</span>
            </p>
          </div>
        </div>
      )}

      {/* Cobertura total */}
      {stats.totalContactados > 0 && (
        <div className="mt-4 bg-[#1a1a2e] border border-[#2a2a3e] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-foreground font-medium">Cobertura de leads contactados</p>
            <span className="text-sm font-bold text-[#25d366]">{stats.pctLeadsContactados}%</span>
          </div>
          <div className="h-2 rounded-full bg-[#2a2a3e] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${stats.pctLeadsContactados}%`, background: '#25d366' }}
            />
          </div>
          <div className="flex justify-between mt-2 text-xs text-[#4a4a6a]">
            <span>{stats.totalContactados.toLocaleString('es-ES')} contactados</span>
            <span>{stats.pendientes.toLocaleString('es-ES')} pendientes</span>
          </div>
        </div>
      )}
    </section>
  )
}
