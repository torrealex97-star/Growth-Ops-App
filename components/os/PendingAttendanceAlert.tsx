"use client"

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { CalendarClock, Check, X } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { AppointmentStatus } from '@/lib/types/database'
import { useTenant, useTenantId } from '@/lib/tenant-context'

// Reuniones que ya pasaron pero se quedaron sin resolver (nadie marcó si el lead se presentó o
// no). Sin esto, se pierde el dato de asistencia y las métricas de show-rate quedan huecas.
const UNRESOLVED_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'rescheduled']

type PendingAppt = {
  id: string
  appointment_datetime: string
  contacts: { full_name: string | null } | null
}

export function PendingAttendanceAlert({ userId, isLeadership }: { userId: string; isLeadership: boolean }) {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [pending, setPending] = useState<PendingAppt[]>([])
  const [updating, setUpdating] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    const supabase = createClient()
    let query = supabase
      .from('appointments')
      .select('id, appointment_datetime, contacts(full_name)')
      .eq('tenant_id', tenantId)
      .in('status', UNRESOLVED_STATUSES)
      .lt('appointment_datetime', new Date().toISOString())
      .order('appointment_datetime', { ascending: false })
      .limit(20)
    if (!isLeadership) {
      query = query.or(`setter_id.eq.${userId},closer_id.eq.${userId}`)
    }
    const { data } = await query
    setPending((data ?? []) as unknown as PendingAppt[])
    setLoading(false)
  }

  useEffect(() => { load() }, [userId, isLeadership])

  const markStatus = async (id: string, status: AppointmentStatus) => {
    setUpdating(id)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: id, status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setPending((prev) => prev.filter((p) => p.id !== id))
      toast.success(status === 'show' ? 'Marcada como asistió' : 'Marcada como no show')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar')
    } finally {
      setUpdating(null)
    }
  }

  if (loading || pending.length === 0) return null

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 mb-6">
      <h2 className="text-sm font-semibold text-amber-400 flex items-center gap-2">
        <CalendarClock className="w-4 h-4" /> Reuniones pasadas sin marcar asistencia ({pending.length})
      </h2>
      <p className="text-xs text-muted-foreground mt-1 mb-3">
        Marca si el lead se presentó o no para que las métricas de show-rate queden correctas.
      </p>
      <div className="space-y-2">
        {pending.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-card/60 border border-border/60 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-foreground truncate">{p.contacts?.full_name ?? 'Sin nombre'}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(p.appointment_datetime)}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="outline"
                disabled={updating === p.id}
                onClick={() => markStatus(p.id, 'show')}
                className="h-7 text-xs gap-1 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              >
                <Check className="w-3 h-3" /> Asistió
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={updating === p.id}
                onClick={() => markStatus(p.id, 'no_show')}
                className="h-7 text-xs gap-1 border-red-500/40 text-red-400 hover:bg-red-500/10"
              >
                <X className="w-3 h-3" /> No Show
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
