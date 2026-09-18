'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Trophy, Plus, Trash2, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useTenantId } from '@/lib/tenant-context'
import { formatNumber } from '@/lib/utils'

type Tramo = {
  id: string
  name: string
  threshold: number | string
  emoji: string | null
  reward: string | null
  sort_order: number
  is_active: boolean
}
type Metric = 'sales' | 'cash_collected'
type Period = 'month' | 'all'

const cls =
  'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500'

export default function TramosSettingsPage() {
  const tenantId = useTenantId()
  const [tramos, setTramos] = useState<Tramo[]>([])
  const [metric, setMetric] = useState<Metric>('sales')
  const [period, setPeriod] = useState<Period>('month')
  const [loading, setLoading] = useState(true)
  const [savingCfg, setSavingCfg] = useState(false)
  const [tableMissing, setTableMissing] = useState(false)

  // Nuevo tramo
  const [nName, setNName] = useState('')
  const [nThreshold, setNThreshold] = useState('')
  const [nEmoji, setNEmoji] = useState('')
  const [nReward, setNReward] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const sb = createClient()
    const [tRes, cRes] = await Promise.all([
      sb.from('sales_tramos').select('*').eq('tenant_id', tenantId).order('threshold', { ascending: true }),
      sb.from('sales_tramos_config').select('metric, period').eq('id', 1).eq('tenant_id', tenantId).maybeSingle(),
    ])
    if (tRes.error && /relation .* does not exist|sales_tramos/.test(tRes.error.message)) setTableMissing(true)
    setTramos((tRes.data as Tramo[]) ?? [])
    const cfg = cRes.data as { metric?: Metric; period?: Period } | null
    if (cfg?.metric) setMetric(cfg.metric)
    if (cfg?.period) setPeriod(cfg.period)
    setLoading(false)
  }, [tenantId])

  useEffect(() => {
    load()
  }, [load])

  const saveConfig = async (nextMetric: Metric, nextPeriod: Period) => {
    setSavingCfg(true)
    const sb = createClient()
    const { error } = await sb
      .from('sales_tramos_config')
      .upsert({ id: 1, tenant_id: tenantId, metric: nextMetric, period: nextPeriod })
    setSavingCfg(false)
    if (error) {
      toast.error('No se pudo guardar la configuración', { description: error.message })
      return
    }
    toast.success('Configuración guardada')
  }

  const addTramo = async () => {
    const name = nName.trim()
    const threshold = parseFloat(nThreshold)
    if (!name) {
      toast.error('Ponle nombre al tramo')
      return
    }
    if (!Number.isFinite(threshold) || threshold <= 0) {
      toast.error('Indica un umbral válido')
      return
    }
    setAdding(true)
    const sb = createClient()
    const { data, error } = await sb
      .from('sales_tramos')
      .insert({
        name,
        threshold,
        emoji: nEmoji.trim() || null,
        reward: nReward.trim() || null,
        sort_order: tramos.length + 1,
        is_active: true,
        tenant_id: tenantId,
      })
      .select()
      .single()
    setAdding(false)
    if (error) {
      toast.error('No se pudo crear el tramo', { description: error.message })
      return
    }
    setTramos((prev) => [...prev, data as Tramo].sort((a, b) => Number(a.threshold) - Number(b.threshold)))
    setNName('')
    setNThreshold('')
    setNEmoji('')
    setNReward('')
    toast.success('Tramo creado')
  }

  const deleteTramo = async (id: string) => {
    if (!window.confirm('¿Borrar este tramo?')) return
    const sb = createClient()
    const { error } = await sb.from('sales_tramos').delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) {
      toast.error('No se pudo borrar', { description: error.message })
      return
    }
    setTramos((prev) => prev.filter((t) => t.id !== id))
  }

  const unit = metric === 'cash_collected' ? '€' : 'ventas'

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
          <Trophy className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tramos / niveles de desbloqueo</h1>
          <p className="text-muted-foreground text-sm">
            Niveles que el equipo desbloquea en su dashboard (con confeti al llegar).
          </p>
        </div>
      </div>

      {tableMissing && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300">
          Falta aplicar la migración <code className="text-amber-200">scripts/migration-v26-tramos.sql</code> en
          Supabase para activar los tramos.
        </div>
      )}

      {/* Configuración global */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Configuración</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Métrica del nivel</label>
            <select
              value={metric}
              onChange={(e) => {
                const v = e.target.value as Metric
                setMetric(v)
                saveConfig(v, period)
              }}
              className={cls}
              disabled={savingCfg}
            >
              <option value="sales">Nº de ventas completadas (no cuenta reserva)</option>
              <option value="cash_collected">Cash collected (€)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Periodo</label>
            <select
              value={period}
              onChange={(e) => {
                const v = e.target.value as Period
                setPeriod(v)
                saveConfig(metric, v)
              }}
              className={cls}
              disabled={savingCfg}
            >
              <option value="month">Mes en curso (se reinicia cada mes)</option>
              <option value="all">Histórico (acumulado total)</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Los umbrales de los tramos se miden en <span className="text-foreground">{unit}</span>. En «Nº de ventas»
          cuentan todas las ventas cerradas salvo las reservas sin completar.
        </p>
      </div>

      {/* Lista de tramos */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Niveles</h2>
        {loading ? (
          <div className="h-20 bg-muted/50 rounded-lg animate-pulse" />
        ) : tramos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay tramos. Crea el primero abajo.</p>
        ) : (
          <div className="space-y-2">
            {tramos.map((t, i) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                <span className="text-xl w-8 text-center">{t.emoji || '🎯'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-medium truncate">{t.name}</p>
                  {t.reward && <p className="text-xs text-muted-foreground truncate">{t.reward}</p>}
                </div>
                <span className="text-sm text-amber-300 font-semibold whitespace-nowrap">
                  {metric === 'cash_collected'
                    ? `${formatNumber(Number(t.threshold))} €`
                    : `${Number(t.threshold)} ventas`}
                </span>
                <span className="text-xs text-muted-foreground w-6 text-center">#{i + 1}</span>
                <button onClick={() => deleteTramo(t.id)} className="text-muted-foreground hover:text-red-400 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Nuevo tramo */}
        <div className="border-t border-border pt-4 grid grid-cols-1 sm:grid-cols-[auto,1fr,140px] gap-2 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Emoji</label>
            <input
              value={nEmoji}
              onChange={(e) => setNEmoji(e.target.value)}
              placeholder="🏆"
              className={`${cls} w-16 text-center`}
              maxLength={4}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Nombre del nivel</label>
            <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Nivel Oro" className={cls} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Umbral ({unit})</label>
            <input
              value={nThreshold}
              onChange={(e) => setNThreshold(e.target.value)}
              type="number"
              min={1}
              placeholder={metric === 'cash_collected' ? '10000' : '10'}
              className={cls}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs text-muted-foreground">Recompensa / nota (opcional)</label>
            <input
              value={nReward}
              onChange={(e) => setNReward(e.target.value)}
              placeholder="Bonus, premio, reconocimiento…"
              className={cls}
            />
          </div>
          <Button onClick={addTramo} disabled={adding} className="bg-brand-600 hover:bg-brand-500 sm:col-span-1">
            {adding ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4 mr-1" /> Añadir
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
