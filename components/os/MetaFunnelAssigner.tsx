'use client'

// Asignación MANUAL de funnel por campaña (§2 de la spec Meta Ads). La sugerencia por nombre se
// ofrece editable; la asignación guardada (campaign_funnel_assignments) manda sobre ella.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Tags } from 'lucide-react'
import type { Campaign } from '@/lib/types/database'
import { suggestFunnelByName, type AsignacionFunnel } from '@/lib/meta/funnels'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const OPCIONES: { value: AsignacionFunnel; label: string }[] = [
  { value: 'vsl', label: 'VSL' },
  { value: 'dm', label: 'DM Funnel' },
  { value: 'webinar', label: 'Webinar' },
  { value: 'custom', label: 'Personalizado' },
]

type Asignaciones = Record<string, AsignacionFunnel>

export function MetaFunnelAssigner({
  tenant,
  campaigns,
  open,
  onClose,
}: {
  tenant: string
  campaigns: Campaign[]
  open: boolean
  onClose: () => void
}) {
  const [asignaciones, setAsignaciones] = useState<Asignaciones>({})
  const [cargado, setCargado] = useState(false)
  const [guardando, setGuardando] = useState<string | null>(null)

  useEffect(() => {
    if (!open || cargado) return
    ;(async () => {
      try {
        const res = await fetch(`/api/${tenant}/evergreen/meta/campaign-funnels`)
        const json = await res.json()
        if (res.ok) {
          const map: Asignaciones = {}
          for (const [cid, v] of Object.entries(json.byCampaign ?? {})) {
            map[cid] = (v as { funnel_type: AsignacionFunnel }).funnel_type
          }
          setAsignaciones(map)
        }
      } finally {
        setCargado(true)
      }
    })()
  }, [open, cargado, tenant])

  if (!open) return null

  const meta = campaigns.filter((c) => c.provider === 'meta')

  const asignar = async (campaignId: string, funnel: AsignacionFunnel) => {
    setGuardando(campaignId)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/meta/campaign-funnels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, funnel_type: funnel }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al asignar')
      setAsignaciones((prev) => ({ ...prev, [campaignId]: funnel }))
    } catch (e) {
      toast.error('No se pudo asignar el funnel', { description: e instanceof Error ? e.message : undefined })
    } finally {
      setGuardando(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] w-full max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Tags className="h-5 w-5 text-brand-400" /> Funnel por campaña
          </DialogTitle>
          <DialogDescription>
            Cada campaña Meta se asigna al funnel que le corresponde. El dashboard recalcula sus KPIs y columnas según
            esta asignación. La sugerencia automática es solo un punto de partida: corrígela donde toque.
          </DialogDescription>
        </DialogHeader>

        {meta.length === 0 ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">No hay campañas Meta sincronizadas todavía.</p>
        ) : (
          <div className="mt-4 divide-y divide-border">
            {meta.map((c) => {
              const sugerida = suggestFunnelByName(c.name)
              const actual = asignaciones[c.id]
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground" title={c.name}>
                      {c.name}
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      {actual ? (
                        <>Asignado: {OPCIONES.find((o) => o.value === actual)?.label}</>
                      ) : sugerida ? (
                        <>Sugerido por nombre: {OPCIONES.find((o) => o.value === sugerida)?.label} (sin guardar)</>
                      ) : (
                        'Sin asignar — no aparecerá en ningún funnel hasta que elijas uno'
                      )}
                    </p>
                  </div>
                  <select
                    value={actual ?? ''}
                    disabled={guardando === c.id}
                    onChange={(e) => e.target.value && asignar(c.id, e.target.value as AsignacionFunnel)}
                    className="h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground focus:border-brand-500 focus:outline-none disabled:opacity-50"
                  >
                    <option value="">Sin asignar…</option>
                    {OPCIONES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
