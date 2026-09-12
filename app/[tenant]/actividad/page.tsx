'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Activity, CalendarCheck, Trophy, StickyNote, PhoneCall } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { useTenant, useTenantId } from '@/lib/tenant-context'

// Timeline unificado de actividad por comercial. La tabla `activities` (llamadas registradas
// manualmente) casi no se usa todavía, así que el feed se construye también con eventos reales que
// YA existen: agendas creadas/asignadas, ventas cerradas y notas dejadas. Sirve para coaching
// individual e identificar patrones. Es solo lectura.

type FeedItem = {
  id: string
  personId: string | null
  datetime: string
  kind: 'agenda' | 'venta' | 'nota' | 'llamada'
  title: string
  detail: string
  contactId: string | null
  contactName: string
}

const KIND_META: Record<FeedItem['kind'], { label: string; color: string; Icon: typeof Activity }> = {
  agenda: { label: 'Agenda', color: 'text-brand-400', Icon: CalendarCheck },
  venta: { label: 'Venta', color: 'text-emerald-400', Icon: Trophy },
  nota: { label: 'Nota', color: 'text-amber-400', Icon: StickyNote },
  llamada: { label: 'Llamada', color: 'text-sky-400', Icon: PhoneCall },
}

type PersonRow = { id: string; full_name: string }

export default function ActividadPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [loading, setLoading] = useState(true)
  const [people, setPeople] = useState<PersonRow[]>([])
  const [personId, setPersonId] = useState<string>('all')
  const [items, setItems] = useState<FeedItem[]>([])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const supabase = createClient()
      const [usersRes, apptRes, salesRes, notesRes, actRes] = await Promise.all([
        supabase.from('users').select('id, full_name').order('full_name'),
        supabase
          .from('appointments')
          .select('id, appointment_datetime, status, setter_id, closer_id, contact_id, contacts(full_name)')
          .eq('tenant_id', tenantId)
          .order('appointment_datetime', { ascending: false })
          .limit(500),
        supabase
          .from('sales')
          .select('id, sale_date, gross_amount, closer_id, setter_id, contact_id, status, contacts(full_name)')
          .eq('tenant_id', tenantId)
          .order('sale_date', { ascending: false })
          .limit(500),
        supabase
          .from('contact_notes')
          .select('id, created_at, note, author_id, contact_id, contacts(full_name)')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('activities')
          .select('id, activity_datetime, type, result, notes, person_id, contact_id, contacts(full_name)')
          .eq('tenant_id', tenantId)
          .order('activity_datetime', { ascending: false })
          .limit(500),
      ])
      if (!mounted) return
      setPeople((usersRes.data as PersonRow[]) ?? [])

      const feed: FeedItem[] = []
      const nameOf = (c: unknown) => {
        const rel = c as { full_name?: string } | { full_name?: string }[] | null
        return (Array.isArray(rel) ? rel[0]?.full_name : rel?.full_name) ?? 'Contacto'
      }

      for (const a of (apptRes.data ?? []) as Record<string, unknown>[]) {
        const contactName = nameOf(a.contacts)
        if (a.setter_id) {
          feed.push({
            id: `appt-set-${a.id}`, personId: a.setter_id as string, datetime: a.appointment_datetime as string,
            kind: 'agenda', title: `Agendó cita con ${contactName}`, detail: `Estado: ${a.status}`,
            contactId: a.contact_id as string, contactName,
          })
        }
        if (a.closer_id && a.closer_id !== a.setter_id) {
          feed.push({
            id: `appt-clo-${a.id}`, personId: a.closer_id as string, datetime: a.appointment_datetime as string,
            kind: 'agenda', title: `Cita asignada con ${contactName}`, detail: `Estado: ${a.status}`,
            contactId: a.contact_id as string, contactName,
          })
        }
      }
      for (const s of (salesRes.data ?? []) as Record<string, unknown>[]) {
        if (s.status !== 'active' && s.status !== 'partial_refund') continue
        const contactName = nameOf(s.contacts)
        const who = (s.closer_id as string) || (s.setter_id as string) || null
        feed.push({
          id: `sale-${s.id}`, personId: who, datetime: s.sale_date as string,
          kind: 'venta', title: `Cerró venta con ${contactName}`, detail: formatCurrency(Number(s.gross_amount) || 0),
          contactId: s.contact_id as string, contactName,
        })
      }
      for (const n of (notesRes.data ?? []) as Record<string, unknown>[]) {
        const contactName = nameOf(n.contacts)
        feed.push({
          id: `note-${n.id}`, personId: (n.author_id as string) ?? null, datetime: n.created_at as string,
          kind: 'nota', title: `Nota en ${contactName}`, detail: String(n.note ?? '').slice(0, 120),
          contactId: n.contact_id as string, contactName,
        })
      }
      for (const ac of (actRes.data ?? []) as Record<string, unknown>[]) {
        const contactName = nameOf(ac.contacts)
        feed.push({
          id: `act-${ac.id}`, personId: (ac.person_id as string) ?? null, datetime: ac.activity_datetime as string,
          kind: 'llamada', title: `${String(ac.type ?? 'Actividad')} — ${contactName}`,
          detail: String(ac.result ?? ac.notes ?? ''), contactId: ac.contact_id as string, contactName,
        })
      }

      feed.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())
      setItems(feed)
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [])

  const filtered = useMemo(
    () => (personId === 'all' ? items : items.filter((i) => i.personId === personId)).slice(0, 300),
    [items, personId]
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Actividad por comercial</h1>
            <p className="text-muted-foreground text-sm mt-1">Línea de tiempo: agendas, ventas y notas de cada persona</p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Comercial</span>
          <select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-brand-500"
          >
            <option value="all">Todo el equipo</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 bg-card border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-10 text-center">
          <Activity className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Sin actividad registrada para esta selección.</p>
          <p className="text-muted-foreground text-sm mt-1">Las agendas, ventas y notas del comercial aparecerán aquí en orden cronológico.</p>
        </div>
      ) : (
        <div className="relative border-l border-border ml-3 space-y-4">
          {filtered.map((it) => {
            const { color, Icon, label } = KIND_META[it.kind]
            const dt = new Date(it.datetime)
            return (
              <div key={it.id} className="relative pl-6">
                <span className="absolute -left-[9px] top-1.5 w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center">
                  <Icon className={`w-2.5 h-2.5 ${color}`} />
                </span>
                <div className="bg-card border border-border rounded-lg px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`text-[10px] uppercase tracking-wider font-semibold ${color}`}>{label}</span>
                    <span className="text-xs text-muted-foreground">{dt.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </div>
                  <p className="text-sm text-foreground mt-0.5">
                    {it.contactId ? (
                      <Link href={`/${tenant}/crm/contactos/${it.contactId}`} className="hover:text-brand-300">{it.title}</Link>
                    ) : it.title}
                  </p>
                  {it.detail && <p className="text-xs text-muted-foreground mt-0.5 truncate">{it.detail}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
