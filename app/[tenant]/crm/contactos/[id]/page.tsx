'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ContactForm, type ContactFormData } from '@/components/contacts/ContactForm'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  ArrowLeft,
  Mail,
  Phone,
  Globe,
  Building2,
  Calendar,
  ShoppingCart,
  PlayCircle,
  AtSign,
  UserX,
  Send,
  MessageSquare,
  GraduationCap,
  Tag,
  Clock,
  Link2,
  ShoppingBag,
  StickyNote,
  FileText,
} from 'lucide-react'
import { formatDate, formatDateTime, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import type { Contact, ContactAttribution, Appointment, Sale, User } from '@/lib/types/database'
import type { Qualification, QualificationAnswer } from '@/lib/qualification'
import { LEAD_STATUS_COLORS, LEAD_STATUS_LABELS } from '@/lib/lead-status'
import { useTenant, useTenantId } from '@/lib/tenant-context'
import { buildContactTimeline, type TimelineEventType } from '@/lib/contact-timeline'
import { isNoShow } from '@/lib/appointments/status'

type ContactNote = {
  id: string
  contact_id: string
  author_id: string | null
  note: string
  created_at: string
  author?: { full_name: string } | null
}

const APPOINTMENT_STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  confirmed: 'bg-green-500/20 text-green-400 border-green-500/30',
  show: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  no_show: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled: 'bg-zinc-500/20 text-muted-foreground border-border/30',
  rescheduled: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  cancelled_admin: 'bg-zinc-500/20 text-muted-foreground border-border/30',
  cancelled_lead: 'bg-zinc-500/20 text-muted-foreground border-border/30',
}

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Programada',
  confirmed: 'Confirmada',
  show: 'Se presentó',
  no_show: 'No show',
  cancelled: 'Cancelada',
  rescheduled: 'Reagendada',
  completed: 'Completada',
  cancelled_admin: 'Cancelada (admin)',
  cancelled_lead: 'Cancelada (lead)',
}

const SALE_STATUS_COLORS: Record<string, string> = {
  // Verde = dinero cobrado, coherente con la categoría "Comprado" del calendario de citas.
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  refunded: 'bg-red-500/20 text-red-400 border-red-500/30',
  partial_refund: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  chargeback: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled: 'bg-zinc-500/20 text-muted-foreground border-border/30',
}

const ENGAGEMENT_COLORS: Record<string, string> = {
  alto: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  medio: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  bajo: 'bg-red-500/20 text-red-400 border-red-500/30',
}

type AppointmentWithNames = Appointment & {
  setter?: { full_name: string } | null
  closer?: { full_name: string } | null
}

const TIMELINE_ICON: Record<TimelineEventType, typeof Clock> = {
  attribution: Link2,
  appointment: Calendar,
  transcript: FileText,
  sale: ShoppingBag,
  note: StickyNote,
}

// Next.js 15: `params` pasa a ser una Promise — useParams() de next/navigation sigue siendo
// síncrono en Client Components, evita React.use() (requiere React 19).
export default function ContactDetailPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [contact, setContact] = useState<Contact | null>(null)
  const [attributions, setAttributions] = useState<ContactAttribution[]>([])
  const [appointments, setAppointments] = useState<AppointmentWithNames[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [notes, setNotes] = useState<ContactNote[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [currentUser, setCurrentUser] = useState<Pick<User, 'id'> | null>(null)

  const timeline = useMemo(
    () => buildContactTimeline(attributions, appointments, sales, notes),
    [attributions, appointments, sales, notes]
  )

  const load = async () => {
    const supabase = createClient()

    const [{ data: authData }, contactRes, attrRes, appRes, salesRes, notesRes] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from('contacts').select('*').eq('id', id).eq('tenant_id', tenantId).single(),
      supabase
        .from('contact_attributions')
        .select('*')
        .eq('contact_id', id)
        .eq('tenant_id', tenantId)
        .order('first_touch_at'),
      supabase
        .from('appointments')
        .select('*, setter:setter_id(full_name), closer:closer_id(full_name)')
        .eq('contact_id', id)
        .eq('tenant_id', tenantId)
        .order('appointment_datetime', { ascending: false }),
      supabase
        .from('sales')
        .select('*')
        .eq('contact_id', id)
        .eq('tenant_id', tenantId)
        .order('sale_date', { ascending: false }),
      supabase
        .from('contact_notes')
        .select('*, author:author_id(full_name)')
        .eq('contact_id', id)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
    ])

    if (authData?.user) setCurrentUser({ id: authData.user.id })

    if (contactRes.error || !contactRes.data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    // Sin esto, un fallo de RLS en sales/appointments de este contacto (p.ej. por scope de
    // equipo) mostraba "sin ventas / sin citas" en silencio, cuando en realidad las hay pero
    // están ocultas por permisos — riesgo de decisión errónea (duplicar una venta creyendo que
    // no existe).
    if (attrRes.error) toast.error('Error al cargar la atribución', { description: attrRes.error.message })
    if (appRes.error) toast.error('Error al cargar las agendas', { description: appRes.error.message })
    if (salesRes.error) toast.error('Error al cargar las ventas', { description: salesRes.error.message })
    if (notesRes.error) toast.error('Error al cargar las notas', { description: notesRes.error.message })

    setContact(contactRes.data)
    setAttributions(attrRes.data ?? [])
    setAppointments((appRes.data as AppointmentWithNames[]) ?? [])
    setSales(salesRes.data ?? [])
    setNotes((notesRes.data as ContactNote[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleUpdateContact = async (formData: ContactFormData) => {
    if (!contact) return
    setSaving(true)
    const fullName = [formData.first_name, formData.last_name].filter(Boolean).join(' ')

    // Vía API con service-role: contacts solo tiene política RLS de SELECT, así que un
    // UPDATE directo desde el cliente lo bloqueaba en silencio para roles no-admin
    // (0 filas afectadas, sin error) — el toast decía "actualizado" pero no se guardaba nada.
    const res = await fetch(`/api/${tenant}/evergreen/contacts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    })
    const data = await res.json().catch(() => ({}))

    setSaving(false)

    if (!res.ok) {
      toast.error('Error al actualizar el contacto', { description: data?.error })
      return
    }

    toast.success('Contacto actualizado')
    setContact({ ...contact, ...formData, full_name: fullName })
  }

  const handleAddNote = async () => {
    if (!newNote.trim()) return
    setSavingNote(true)
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { error } = await supabase.from('contact_notes').insert({
      contact_id: id,
      author_id: user?.id ?? currentUser?.id ?? null,
      note: newNote.trim(),
      tenant_id: tenantId,
    })

    setSavingNote(false)

    if (error) {
      toast.error('Error al añadir la nota', { description: error.message })
      return
    }

    toast.success('Nota añadida')
    setNewNote('')

    const { data: notesData } = await supabase
      .from('contact_notes')
      .select('*, author:author_id(full_name)')
      .eq('contact_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    setNotes((notesData as ContactNote[]) ?? [])
  }

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <div className="h-8 w-48 bg-card rounded animate-pulse" />
        <div className="h-32 bg-card rounded-lg animate-pulse" />
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      </div>
    )
  }

  if (notFound || !contact) {
    return (
      <div className="p-6">
        <div className="bg-card border border-border rounded-lg p-12 text-center flex flex-col items-center">
          <UserX className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-foreground font-medium mb-1">Contacto no encontrado</p>
          <p className="text-muted-foreground text-sm mb-4">
            Puede que haya sido eliminado o el enlace sea incorrecto.
          </p>
          <Link href={`/${tenant}/crm/contactos`}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Volver a contactos
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  const isAlumno =
    contact.engagement_score != null ||
    contact.nps != null ||
    contact.promise_fulfilled != null ||
    contact.ttfv_date != null

  return (
    <div className="p-6 space-y-6">
      {/* Back + Header */}
      <div>
        <Link href={`/${tenant}/crm/contactos`}>
          <Button variant="ghost" size="sm" className="mb-4 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Volver
          </Button>
        </Link>

        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{contact.full_name}</h1>
              <Badge className={`border text-xs ${LEAD_STATUS_COLORS[contact.lead_status] ?? ''}`}>
                {LEAD_STATUS_LABELS[contact.lead_status] ?? contact.lead_status}
              </Badge>
              {contact.lead_score != null && (
                <Badge className="bg-brand-500/20 text-brand-400 border-brand-500/30 border text-xs">
                  Lead score: {contact.lead_score}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              {contact.email && (
                <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
                  <Mail className="w-3 h-3" />
                  {contact.email}
                </span>
              )}
              {contact.phone && (
                <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
                  <Phone className="w-3 h-3" />
                  {contact.phone}
                </span>
              )}
              {contact.country && (
                <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
                  <Globe className="w-3 h-3" />
                  {contact.country}
                </span>
              )}
              {contact.company_name && (
                <span className="flex items-center gap-1.5 text-muted-foreground text-sm">
                  <Building2 className="w-3 h-3" />
                  {contact.company_name}
                </span>
              )}
              {contact.instagram && (
                <a
                  href={
                    contact.instagram.startsWith('http')
                      ? contact.instagram
                      : `https://instagram.com/${contact.instagram.replace('@', '')}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-pink-400 hover:text-pink-300 text-sm"
                >
                  <AtSign className="w-3 h-3" />
                  {contact.instagram}
                </a>
              )}
              {contact.vsl_watch_pct != null && (
                <span className="flex items-center gap-1.5 text-sm">
                  <PlayCircle className="w-3 h-3 text-brand-400" />
                  <span className={contact.vsl_watch_pct >= 75 ? 'text-emerald-400' : 'text-foreground'}>
                    VSL {Number(contact.vsl_watch_pct)}% visto
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="timeline">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="info">Información</TabsTrigger>
          <TabsTrigger value="attribution">
            Atribución
            {attributions.length > 0 && (
              <span className="ml-1.5 text-xs bg-muted px-1.5 rounded-full">{attributions.length}</span>
            )}
          </TabsTrigger>
          {isAlumno && <TabsTrigger value="alumno">Alumno</TabsTrigger>}
          <TabsTrigger value="notes">
            Notas
            {notes.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 rounded-full">{notes.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="appointments">
            Agendas
            {appointments.length > 0 && (
              <span className="ml-1.5 text-xs bg-muted px-1.5 rounded-full">{appointments.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="sales">
            Ventas
            {sales.length > 0 && <span className="ml-1.5 text-xs bg-muted px-1.5 rounded-full">{sales.length}</span>}
          </TabsTrigger>
        </TabsList>

        {/* Timeline unificada: atribución + agendas + transcripciones + ventas + notas, en orden
            cronológico — una sola historia, sin pestaña por proveedor. */}
        <TabsContent value="timeline" className="mt-4">
          <div className="bg-card border border-border rounded-lg p-6">
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Sin actividad registrada todavía para este contacto.
              </p>
            ) : (
              <ol className="space-y-4">
                {timeline.map((event) => {
                  const Icon = TIMELINE_ICON[event.type]
                  return (
                    <li key={event.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="mt-1 w-px flex-1 bg-border" />
                      </div>
                      <div className="pb-4">
                        <p className="text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</p>
                        <p className="text-sm font-medium text-foreground">{event.title}</p>
                        {event.detail && <p className="text-sm text-muted-foreground">{event.detail}</p>}
                        {event.source && event.type !== 'note' && (
                          <p className="text-xs text-muted-foreground/70">{event.source}</p>
                        )}
                        {event.transcriptRef && (
                          <p className="mt-1 text-xs font-medium text-brand-400">
                            Transcripción completa en la pestaña Agendas
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </TabsContent>

        {/* Informacion */}
        <TabsContent value="info" className="mt-4 space-y-4">
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Datos del contacto
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Email', value: contact.email },
                { label: 'Teléfono', value: contact.phone },
                { label: 'Instagram', value: contact.instagram },
                { label: 'País', value: contact.country },
                { label: 'Empresa', value: contact.company_name },
                { label: 'Género', value: contact.gender },
                { label: 'Edad', value: contact.age != null ? String(contact.age) : null },
                { label: 'Lead score', value: contact.lead_score != null ? String(contact.lead_score) : null },
                {
                  label: 'GHL Contact ID',
                  value:
                    ((contact as unknown as Record<string, unknown>).ghl_contact_id as string | null | undefined) ??
                    null,
                },
                { label: 'Origen del set (set_source)', value: contact.set_source },
                { label: 'Canal', value: contact.lead_channel },
                { label: 'Fecha opt-in', value: contact.optin_date ? formatDate(contact.optin_date) : null },
                {
                  label: 'Intentos de contacto',
                  value: contact.contact_attempts != null ? String(contact.contact_attempts) : null,
                },
                { label: 'Motivo descarte', value: contact.discard_reason },
                {
                  label: 'Primera vez visto',
                  value: contact.first_seen_at ? formatDateTime(contact.first_seen_at) : null,
                },
                {
                  label: 'Primer contacto',
                  value: contact.first_contact_at ? formatDateTime(contact.first_contact_at) : null,
                },
                {
                  label: 'Última vez visto',
                  value: contact.last_seen_at ? formatDateTime(contact.last_seen_at) : null,
                },
                { label: 'Creado', value: contact.created_at ? formatDateTime(contact.created_at) : null },
                { label: 'Actualizado', value: contact.updated_at ? formatDateTime(contact.updated_at) : null },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground mb-1">{label}</dt>
                  <dd className="text-sm text-foreground font-medium break-words">{value || '—'}</dd>
                </div>
              ))}
            </div>
            {contact.notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <dt className="text-xs text-muted-foreground mb-1">Notas generales</dt>
                <dd className="text-sm text-foreground whitespace-pre-wrap">{contact.notes}</dd>
              </div>
            )}
          </div>

          {(() => {
            const q = (contact as unknown as { qualification?: Qualification | null }).qualification
            const respuestas: QualificationAnswer[] = Array.isArray(q?.respuestas) ? q!.respuestas! : []
            if (respuestas.length === 0) return null
            const updatedAt = (contact as unknown as { qualification_updated_at?: string | null })
              .qualification_updated_at
            return (
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Formulario / Cualificación
                  {updatedAt && (
                    <span className="text-xs text-muted-foreground font-normal">· {formatDate(updatedAt)}</span>
                  )}
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {respuestas.map((r, i) => (
                    <div key={i}>
                      <dt className="text-xs text-muted-foreground mb-1">{r.q}</dt>
                      <dd className="text-sm text-foreground whitespace-pre-wrap">{r.a || '—'}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )
          })()}

          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">Editar contacto</h3>
            <ContactForm
              defaultValues={{
                first_name: contact.first_name ?? '',
                last_name: contact.last_name ?? '',
                email: contact.email ?? '',
                phone: contact.phone ?? '',
                country: contact.country ?? '',
                company_name: contact.company_name ?? '',
                instagram: contact.instagram ?? '',
                notes: contact.notes ?? '',
              }}
              onSubmit={handleUpdateContact}
              submitLabel="Actualizar Contacto"
              loading={saving}
            />
          </div>
        </TabsContent>

        {/* Atribucion */}
        <TabsContent value="attribution" className="mt-4">
          {attributions.length === 0 ? (
            <div className="bg-card border border-border rounded-lg p-8 text-center">
              <p className="text-muted-foreground text-sm">
                Sin datos de atribución. Se añadirán automáticamente cuando llegue una agenda desde GHL.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {attributions.map((attr) => (
                <div key={attr.id} className="bg-card border border-border rounded-lg p-6">
                  {attr.is_primary && (
                    <div className="flex items-center gap-2 mb-4">
                      <Badge className="bg-brand-500/20 text-brand-400 border-brand-500/30 border text-xs">
                        Atribución principal
                      </Badge>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { label: 'Fuente (source)', value: attr.source },
                      { label: 'Primer contacto', value: attr.first_touch_at ? formatDate(attr.first_touch_at) : null },
                      { label: 'Último contacto', value: attr.last_touch_at ? formatDate(attr.last_touch_at) : null },
                      { label: 'Funnel', value: attr.funnel },
                      { label: 'Landing URL', value: attr.landing_url },
                      { label: '🟢 First UTM Source', value: attr.first_utm_source },
                      { label: '🟢 First UTM Campaign', value: attr.first_utm_campaign },
                      { label: '🟢 First UTM Medium', value: attr.first_utm_medium },
                      { label: '🟢 First UTM Content', value: attr.first_utm_content },
                      { label: '🟢 First UTM Term', value: attr.first_utm_term },
                      { label: '🔵 Last UTM Source', value: attr.last_utm_source },
                      { label: '🔵 Last UTM Campaign', value: attr.last_utm_campaign },
                      { label: '🔵 Last UTM Medium', value: attr.last_utm_medium },
                      { label: '🔵 Last UTM Content', value: attr.last_utm_content },
                      { label: '🔵 Last UTM Term', value: attr.last_utm_term },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <dt className="text-xs text-muted-foreground mb-1">{label}</dt>
                        <dd className="text-sm text-foreground font-medium truncate">{value || '—'}</dd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Alumno */}
        {isAlumno && (
          <TabsContent value="alumno" className="mt-4">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
                <GraduationCap className="w-4 h-4" />
                Seguimiento de alumno
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <dt className="text-xs text-muted-foreground mb-1">Engagement</dt>
                  <dd>
                    {contact.engagement_score ? (
                      <Badge className={`border text-xs ${ENGAGEMENT_COLORS[contact.engagement_score] ?? ''}`}>
                        {contact.engagement_score}
                      </Badge>
                    ) : (
                      <span className="text-sm text-foreground">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground mb-1">NPS</dt>
                  <dd className="text-sm text-foreground font-medium">{contact.nps ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground mb-1">Fecha NPS</dt>
                  <dd className="text-sm text-foreground font-medium">
                    {contact.nps_date ? formatDate(contact.nps_date) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground mb-1">Promesa cumplida</dt>
                  <dd className="text-sm text-foreground font-medium">{contact.promise_fulfilled ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground mb-1">TTFV (Time to First Value)</dt>
                  <dd className="text-sm text-foreground font-medium">
                    {contact.ttfv_date ? formatDate(contact.ttfv_date) : '—'}
                  </dd>
                </div>
              </div>
            </div>
          </TabsContent>
        )}

        {/* Notas */}
        <TabsContent value="notes" className="mt-4 space-y-4">
          <div className="bg-card border border-border rounded-lg p-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Añadir nota
            </h3>
            <div className="flex gap-2">
              <textarea
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                rows={2}
                placeholder="Escribe una nota sobre este contacto..."
                className="flex-1 bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500 resize-none"
              />
              <Button onClick={handleAddNote} disabled={savingNote || !newNote.trim()} className="self-end">
                <Send className="w-4 h-4 mr-2" />
                {savingNote ? 'Guardando...' : 'Añadir'}
              </Button>
            </div>
          </div>

          {notes.length === 0 ? (
            <div className="bg-card border border-border rounded-lg p-8 text-center">
              <p className="text-muted-foreground text-sm">Sin notas todavía.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {notes.map((n) => (
                <div key={n.id} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-foreground">{n.author?.full_name || 'Usuario'}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}</span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{n.note}</p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Agendas */}
        <TabsContent value="appointments" className="mt-4">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {appointments.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-center">
                <Calendar className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No hay agendas para este contacto</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-muted-foreground">Fecha/Hora</TableHead>
                    <TableHead className="text-muted-foreground">Estado</TableHead>
                    <TableHead className="text-muted-foreground">Setter</TableHead>
                    <TableHead className="text-muted-foreground">Closer</TableHead>
                    <TableHead className="text-muted-foreground">Calendario</TableHead>
                    <TableHead className="text-muted-foreground">Fuente</TableHead>
                    <TableHead className="text-muted-foreground">Llamada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {appointments.map((appt) => {
                    const rec = (appt as { recording_url?: string | null }).recording_url
                    const tr = (appt as { transcript_drive_url?: string | null }).transcript_drive_url
                    return (
                      <TableRow key={appt.id} className="border-border">
                        <TableCell className="text-foreground">{formatDateTime(appt.appointment_datetime)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge className={`border text-xs ${APPOINTMENT_STATUS_COLORS[appt.status] ?? ''}`}>
                              {APPOINTMENT_STATUS_LABELS[appt.status] ?? appt.status}
                            </Badge>
                            {isNoShow(appt.rescheduled_from_status) && (
                              <Badge className="border text-xs bg-red-500/10 text-red-400 border-red-500/30">
                                Reagenda / No show
                              </Badge>
                            )}
                            {appt.rescheduled_from_status === 'show' && (
                              <Badge className="border text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                Reagenda / Show
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{appt.setter?.full_name || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{appt.closer?.full_name || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{appt.calendar_name || '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{appt.source || '—'}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            {rec && (
                              <a
                                href={rec}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-brand-400 hover:text-brand-300 text-xs"
                              >
                                Grabación
                              </a>
                            )}
                            {tr && (
                              <a
                                href={tr}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-400 hover:text-sky-300 text-xs"
                              >
                                Transcripción
                              </a>
                            )}
                            {!rec && !tr && <span className="text-muted-foreground text-xs">—</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* Ventas */}
        <TabsContent value="sales" className="mt-4">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {sales.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-center">
                <ShoppingCart className="w-10 h-10 text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No hay ventas para este contacto</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-muted-foreground">Fecha</TableHead>
                    <TableHead className="text-muted-foreground">Importe</TableHead>
                    <TableHead className="text-muted-foreground">Estado</TableHead>
                    <TableHead className="text-muted-foreground">Notas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map((sale) => (
                    <TableRow
                      key={sale.id}
                      className="border-border hover:bg-muted/50 cursor-pointer"
                      onClick={() => router.push(`/${tenant}/ventas/registro/${sale.id}`)}
                    >
                      <TableCell className="text-foreground">{formatDate(sale.sale_date)}</TableCell>
                      <TableCell className="text-foreground font-medium">{formatCurrency(sale.gross_amount)}</TableCell>
                      <TableCell>
                        <Badge className={`border text-xs ${SALE_STATUS_COLORS[sale.status] ?? ''}`}>
                          {sale.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{sale.notes || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
