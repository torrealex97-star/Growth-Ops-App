'use client'

import { Fragment, useState, useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ContactForm, type ContactFormData } from '@/components/contacts/ContactForm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  Pencil,
  ListTree,
  CreditCard,
  AlertCircle,
} from 'lucide-react'
import { formatDate, formatDateTime, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import type {
  Contact,
  ContactAttribution,
  Appointment,
  Sale,
  User,
  PaymentPlan,
  Collection,
  SaleExpectedInstallment,
  Commission,
  CustomFieldDef,
} from '@/lib/types/database'
import { planCuotasDeVenta } from '@/lib/sales/plan-cuotas'
import type { Qualification, QualificationAnswer } from '@/lib/qualification'
import { LEAD_STATUS_COLORS, LEAD_STATUS_LABELS } from '@/lib/lead-status'
import { useSesion, useTenant, useTenantId } from '@/lib/tenant-context'
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
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  show: 'Se presentó',
  no_show: 'No asistió',
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
  created: Clock,
  appointment: Calendar,
  transcript: FileText,
  recording: PlayCircle,
  activity: Phone,
  contract: FileText,
  sale: ShoppingBag,
  payment: CreditCard,
  delinquency: AlertCircle,
  csm: GraduationCap,
  feedback: MessageSquare,
  note: StickyNote,
}

type ContactActivity = {
  id: string
  type: string
  direction: string | null
  result: string | null
  duration_min: number | null
  notes: string | null
  created_at: string
  author?: string
}

type ContactContract = {
  id: string
  title: string | null
  status: string
  url: string | null
  signed_at: string | null
  created_at: string
}

type CsmEvent = {
  id: string
  type: string
  event_datetime: string
  status: string | null
  grade: number | null
  success: string | null
  recording_url: string | null
  notes: string | null
}

// Next.js 15: `params` pasa a ser una Promise — useParams() de next/navigation sigue siendo
// síncrono en Client Components, evita React.use() (requiere React 19).
export default function ContactDetailPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const sesion = useSesion()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [contact, setContact] = useState<Contact | null>(null)
  const [attributions, setAttributions] = useState<ContactAttribution[]>([])
  // Campos personalizados de la subcuenta (§1): catálogo + guardado en lote desde la ficha.
  const [customDefs, setCustomDefs] = useState<CustomFieldDef[]>([])
  const [customDraft, setCustomDraft] = useState<Record<string, string>>({})
  const [customSaving, setCustomSaving] = useState(false)
  const [appointments, setAppointments] = useState<AppointmentWithNames[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  // PLAN DE COBRO + comisiones por venta (22-sep): la ficha deja claro el dinero del contacto
  // — cada cuota con su fecha y estado (Cobrada / Por recolectar / Impago) y las comisiones que
  // cada venta genera con su mes de liquidación. RLS de colaborador scope aplica igual.
  type VentaConPlan = Sale & { payment_plans?: Pick<PaymentPlan, 'number_of_payments' | 'method'> | null }
  const [ventasConPlan, setVentasConPlan] = useState<VentaConPlan[]>([])
  const [installmentsContacto, setInstallmentsContacto] = useState<SaleExpectedInstallment[]>([])
  const [collectionsContacto, setCollectionsContacto] = useState<Collection[]>([])
  const [commissionsContacto, setCommissionsContacto] = useState<Commission[]>([])
  const [csmEvents, setCsmEvents] = useState<CsmEvent[]>([])
  const [notes, setNotes] = useState<ContactNote[]>([])
  const [activities, setActivities] = useState<ContactActivity[]>([])
  const [contracts, setContracts] = useState<ContactContract[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [currentUser, setCurrentUser] = useState<Pick<User, 'id'> | null>(null)
  const [editingAppointmentId, setEditingAppointmentId] = useState<string | null>(null)
  const [appointmentDraft, setAppointmentDraft] = useState<{ status: string; notes: string } | null>(null)
  const [savingAppointment, setSavingAppointment] = useState(false)

  // Historial completo del contacto (petición 22-sep): creado, atribución, agendas, grabaciones,
  // transcripciones, ventas, pagos, impagos, CSM, feedback del formulario, notas y contratos —
  // todo en una sola timeline ordenada por fecha real del evento.
  const timeline = useMemo(
    () =>
      buildContactTimeline(attributions, appointments, sales, notes, activities, contracts, {
        contact: contact ? { createdAt: contact.created_at, fullName: contact.full_name } : null,
        payments: collectionsContacto,
        delinquencies: installmentsContacto,
        csmEvents,
        feedback:
          contact?.qualification_updated_at && (contact.qualification as Qualification | null)?.respuestas?.length
            ? {
                answers: (contact.qualification as Qualification).respuestas ?? [],
                updatedAt: contact.qualification_updated_at,
              }
            : null,
      }),
    [
      attributions,
      appointments,
      sales,
      notes,
      activities,
      contracts,
      contact,
      collectionsContacto,
      installmentsContacto,
      csmEvents,
    ]
  )

  // Desglose de dinero por venta: plan de cuotas (real o previsión) + comisiones generadas.
  const desgloseVentas = useMemo(() => {
    return ventasConPlan.map((venta) => {
      const plan = planCuotasDeVenta(
        installmentsContacto.filter((i) => i.sale_id === venta.id),
        collectionsContacto.filter((c) => c.sale_id === venta.id),
        {
          grossAmount: Number(venta.gross_amount),
          saleDate: venta.sale_date,
          paymentPlan: venta.payment_plans ?? null,
          installmentsCount: venta.installments_count,
          installmentsStartDate: venta.installments_start_date,
        }
      )
      const comisiones = commissionsContacto.filter((c) => c.sale_id === venta.id)
      return { venta, plan, comisiones }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ventasConPlan, installmentsContacto, collectionsContacto, commissionsContacto])

  const load = async () => {
    const supabase = createClient()

    const [
      contactRes,
      attrRes,
      appRes,
      csmRes,
      salesRes,
      notesRes,
      activitiesRes,
      contractsRes,
      defsRes,
      instRes,
      collRes,
      comRes,
    ] = await Promise.all([
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
      // Historial completo: eventos CSM del contacto (onboarding, feedback de clases…).
      supabase.from('csm_events').select('*').eq('contact_id', id).eq('tenant_id', tenantId),
      supabase
        .from('sales')
        .select('*, payment_plans(number_of_payments, method)')
        .eq('contact_id', id)
        .eq('tenant_id', tenantId)
        .order('sale_date', { ascending: false }),
      supabase
        .from('contact_notes')
        .select('*, author:author_id(full_name)')
        .eq('contact_id', id)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
      supabase
        .from('activities')
        .select('id, type, direction, result, duration_min, notes, created_at, users(full_name)')
        .eq('contact_id', id)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
      supabase
        .from('contracts')
        .select('id, title, status, url, signed_at, created_at')
        .eq('contact_id', id)
        .order('created_at', { ascending: false }),
      supabase.from('custom_field_defs').select('*').eq('tenant_id', tenantId).order('sort_order', { ascending: true }),
      // Estado del dinero por venta: filtro por sale_id en cliente (RLS de colaborador aplica igual).
      supabase.from('sale_expected_installments').select('*').eq('tenant_id', tenantId).order('installment_number'),
      supabase.from('collections').select('*').eq('tenant_id', tenantId).order('collected_at'),
      supabase
        .from('commissions')
        .select(
          'id, sale_id, participant_type, percent, base_amount, commission_amount, direction, status, liquidation_month, created_at'
        )
        .eq('tenant_id', tenantId),
    ])

    if (sesion) setCurrentUser({ id: sesion.userId })

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
    if (activitiesRes.error)
      toast.error('Error al cargar las interacciones', { description: activitiesRes.error.message })
    if (contractsRes.error) toast.error('Error al cargar los contratos', { description: contractsRes.error.message })
    if (instRes.error) toast.error('Error al cargar las cuotas', { description: instRes.error.message })
    if (collRes.error) toast.error('Error al cargar los cobros', { description: collRes.error.message })
    if (comRes.error) toast.error('Error al cargar las comisiones', { description: comRes.error.message })
    if (csmRes.error) toast.error('Error al cargar los eventos CSM', { description: csmRes.error.message })

    setContact(contactRes.data)
    setAttributions(attrRes.data ?? [])
    setAppointments((appRes.data as AppointmentWithNames[]) ?? [])
    setSales(salesRes.data ?? [])
    setNotes((notesRes.data as ContactNote[]) ?? [])
    setActivities(
      ((activitiesRes.data ?? []) as Array<ContactActivity & { users?: { full_name?: string } | null }>).map(
        (activity) => ({
          ...activity,
          author: activity.users?.full_name || 'Alguien',
        })
      )
    )
    setContracts((contractsRes.data as ContactContract[]) ?? [])
    setCustomDefs((defsRes.data as CustomFieldDef[]) ?? [])
    setVentasConPlan((salesRes.data as VentaConPlan[]) ?? [])
    setInstallmentsContacto((instRes.data as SaleExpectedInstallment[]) ?? [])
    setCollectionsContacto((collRes.data as Collection[]) ?? [])
    setCommissionsContacto((comRes.data as Commission[]) ?? [])
    setCsmEvents((csmRes.data as CsmEvent[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sesion])

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

    const updatedAt = data?.contact?.updated_at
    const previousValues = {
      first_name: contact.first_name,
      last_name: contact.last_name,
      email: contact.email,
      phone: contact.phone,
      country: contact.country,
      company_name: contact.company_name,
      instagram: contact.instagram,
      notes: contact.notes,
    }
    toast.success('Contacto actualizado', {
      action: updatedAt
        ? {
            label: 'Deshacer',
            onClick: async () => {
              const undoRes = await fetch(`/api/${tenant}/evergreen/contacts/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...previousValues, expectedUpdatedAt: updatedAt }),
              })
              const undoData = await undoRes.json().catch(() => ({}))
              if (!undoRes.ok) {
                toast.error('No se pudo deshacer', { description: undoData?.error })
                return
              }
              setContact(undoData.contact)
              toast.success('Cambio deshecho')
            },
          }
        : undefined,
    })
    setContact({ ...contact, ...formData, full_name: fullName })
  }

  const handleAddNote = async () => {
    if (!newNote.trim()) return
    setSavingNote(true)
    const supabase = createClient()
    const { error } = await supabase.from('contact_notes').insert({
      contact_id: id,
      author_id: sesion?.userId ?? currentUser?.id ?? null,
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

  const startAppointmentEdit = (appointment: AppointmentWithNames) => {
    setEditingAppointmentId(appointment.id)
    setAppointmentDraft({ status: appointment.status, notes: appointment.notes ?? '' })
  }

  const saveAppointmentEdit = async () => {
    if (!editingAppointmentId || !appointmentDraft) return
    const previousAppointment = appointments.find((appointment) => appointment.id === editingAppointmentId)
    setSavingAppointment(true)
    try {
      const [statusRes, notesRes] = await Promise.all([
        fetch(`/api/${tenant}/evergreen/appointments/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appointmentId: editingAppointmentId, status: appointmentDraft.status }),
        }),
        fetch(`/api/${tenant}/evergreen/appointments/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appointmentId: editingAppointmentId,
            patch: { notes: appointmentDraft.notes.trim() },
          }),
        }),
      ])
      const statusData = await statusRes.json().catch(() => ({}))
      const notesData = await notesRes.json().catch(() => ({}))
      if (!statusRes.ok || statusData?.error) throw new Error(statusData?.error || 'No se pudo actualizar el estado')
      if (!notesRes.ok || notesData?.error) throw new Error(notesData?.error || 'No se pudieron guardar las notas')
      setAppointments((current) =>
        current.map((appointment) =>
          appointment.id === editingAppointmentId
            ? {
                ...appointment,
                status: appointmentDraft.status as Appointment['status'],
                notes: appointmentDraft.notes.trim(),
              }
            : appointment
        )
      )
      toast.success('Agenda actualizada', {
        action:
          notesData?.updatedAt && previousAppointment
            ? {
                label: 'Deshacer notas',
                onClick: async () => {
                  const undoRes = await fetch(`/api/${tenant}/evergreen/appointments/update`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      appointmentId: editingAppointmentId,
                      expectedUpdatedAt: notesData.updatedAt,
                      patch: { notes: previousAppointment.notes ?? '' },
                    }),
                  })
                  const undoData = await undoRes.json().catch(() => ({}))
                  if (!undoRes.ok) {
                    toast.error('No se pudieron deshacer las notas', { description: undoData?.error })
                    return
                  }
                  setAppointments((current) =>
                    current.map((appointment) =>
                      appointment.id === editingAppointmentId
                        ? { ...appointment, notes: previousAppointment.notes }
                        : appointment
                    )
                  )
                  toast.success('Notas deshechas')
                },
              }
            : undefined,
      })
      setEditingAppointmentId(null)
      setAppointmentDraft(null)
    } catch (error) {
      toast.error('No se pudo actualizar la agenda', {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSavingAppointment(false)
    }
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

      {/* Tabs — INFORMACIÓN PRIMERO (estilo top CRMs: HubSpot/Salesforce/Pipedrive abren la
          ficha en la vista 360º del contacto; el timeline queda como segundo tab, no al revés). */}
      <Tabs defaultValue="info">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="info">Información</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
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
                      <div className="min-w-0 pb-4">
                        <p className="text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}</p>
                        {event.href ? (
                          <a
                            href={
                              event.href.startsWith('/') && !event.href.startsWith('//')
                                ? `/${tenant}${event.href}`
                                : event.href
                            }
                            target={event.href.startsWith('http') ? '_blank' : undefined}
                            rel={event.href.startsWith('http') ? 'noreferrer' : undefined}
                            className="text-sm font-medium text-brand-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-sm"
                          >
                            {event.title}
                          </a>
                        ) : (
                          <p className="text-sm font-medium text-foreground">{event.title}</p>
                        )}
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

          {/* Campos personalizados de la subcuenta (§1): edición inline con guardado en lote. */}
          {customDefs.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
                <ListTree className="w-4 h-4" />
                Campos personalizados
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {customDefs.map((def) => {
                  const current = contact.custom_fields?.[def.id]
                  const draftValue = customDraft[def.id] ?? (current == null ? '' : String(current))
                  return (
                    <div key={def.id}>
                      <dt className="text-xs text-muted-foreground mb-1">{def.label}</dt>
                      {def.field_type === 'boolean' ? (
                        <select
                          value={draftValue === '' ? '' : draftValue === 'true' ? 'true' : 'false'}
                          onChange={(e) => setCustomDraft((prev) => ({ ...prev, [def.id]: e.target.value }))}
                          className="w-full rounded-md bg-muted border border-border px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                        >
                          <option value="">—</option>
                          <option value="true">Sí</option>
                          <option value="false">No</option>
                        </select>
                      ) : (
                        <Input
                          type={def.field_type === 'number' ? 'number' : def.field_type === 'date' ? 'date' : 'text'}
                          value={draftValue}
                          onChange={(e) => setCustomDraft((prev) => ({ ...prev, [def.id]: e.target.value }))}
                          className="bg-muted border-border h-8 text-sm"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  size="sm"
                  disabled={customSaving || Object.keys(customDraft).length === 0}
                  onClick={async () => {
                    if (!contact) return
                    setCustomSaving(true)
                    const payload: Record<string, string | number | boolean | null> = {}
                    for (const [fieldId, value] of Object.entries(customDraft)) {
                      const def = customDefs.find((d) => d.id === fieldId)
                      if (!def) continue
                      if (value === '') {
                        payload[fieldId] = null
                        continue
                      }
                      payload[fieldId] =
                        def.field_type === 'number'
                          ? Number(value)
                          : def.field_type === 'boolean'
                            ? value === 'true'
                            : value
                    }
                    const res = await fetch(`/api/${tenant}/evergreen/contacts/${id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ custom_fields: payload }),
                    })
                    const d = await res.json().catch(() => ({}))
                    setCustomSaving(false)
                    if (!res.ok) {
                      toast.error('No se pudieron guardar los campos', { description: d?.error })
                      return
                    }
                    toast.success('Campos personalizados guardados')
                    setCustomDraft({})
                    setContact({ ...contact, custom_fields: d?.contact?.custom_fields ?? contact.custom_fields })
                  }}
                >
                  {customSaving ? 'Guardando…' : 'Guardar campos'}
                </Button>
              </div>
            </div>
          )}

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
                    <TableHead className="text-muted-foreground">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {appointments.map((appt) => {
                    const rec = (appt as { recording_url?: string | null }).recording_url
                    const tr = (appt as { transcript_drive_url?: string | null }).transcript_drive_url
                    return (
                      <Fragment key={appt.id}>
                        <TableRow className="border-border">
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
                          <TableCell>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-8 text-xs"
                              onClick={() => startAppointmentEdit(appt)}
                              aria-label={`Editar agenda de ${contact.full_name}`}
                            >
                              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                              Editar
                            </Button>
                          </TableCell>
                        </TableRow>
                        {editingAppointmentId === appt.id && appointmentDraft && (
                          <TableRow className="border-border bg-muted/30">
                            <TableCell colSpan={8}>
                              <div className="grid gap-3 md:grid-cols-[180px_1fr_auto] md:items-end">
                                <label className="space-y-1.5">
                                  <span className="text-xs font-medium text-muted-foreground">Estado</span>
                                  <Select
                                    value={appointmentDraft.status}
                                    onValueChange={(status) =>
                                      setAppointmentDraft((draft) => (draft ? { ...draft, status } : draft))
                                    }
                                  >
                                    <SelectTrigger className="h-9 bg-background" aria-label="Estado de la agenda">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {Object.entries(APPOINTMENT_STATUS_LABELS).map(([status, label]) => (
                                        <SelectItem key={status} value={status}>
                                          {label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </label>
                                <label className="space-y-1.5">
                                  <span className="text-xs font-medium text-muted-foreground">Notas de la llamada</span>
                                  <textarea
                                    value={appointmentDraft.notes}
                                    onChange={(event) =>
                                      setAppointmentDraft((draft) =>
                                        draft ? { ...draft, notes: event.target.value } : draft
                                      )
                                    }
                                    rows={2}
                                    className="w-full resize-y rounded-lg border border-border bg-background p-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                                    aria-label="Notas de la llamada"
                                  />
                                </label>
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={saveAppointmentEdit}
                                    disabled={savingAppointment}
                                  >
                                    {savingAppointment ? 'Guardando…' : 'Guardar'}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setEditingAppointmentId(null)
                                      setAppointmentDraft(null)
                                    }}
                                    disabled={savingAppointment}
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* Ventas */}
        <TabsContent value="sales" className="mt-4 space-y-4">
          {/* PLAN DE COBRO POR VENTA (petición del propietario, 22-sep): cobrado vs por cobrar
              con fechas, cuota a cuota (verde cobrada / por recolectar / rojo impago hasta que
              se soluciona) + comisiones generadas con su mes de liquidación. */}
          {desgloseVentas.map(({ venta, plan, comisiones }) => (
            <div key={venta.id} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-foreground">Venta · {formatDate(venta.sale_date)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Importe: {formatCurrency(venta.gross_amount)} · Estado: {venta.status}
                  </p>
                </div>
                <div className="flex gap-4 text-right">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Cobrado</p>
                    <p className="text-sm font-semibold text-emerald-400">{formatCurrency(plan.cobrado)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Por recolectar</p>
                    <p className="text-sm font-semibold text-foreground">{formatCurrency(plan.porCobrar)}</p>
                    {plan.proximoVencimiento && (
                      <p className="text-[10px] text-muted-foreground">vence {formatDate(plan.proximoVencimiento)}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Impago</p>
                    <p
                      className={`text-sm font-semibold ${plan.impagado > 0 ? 'text-red-400' : 'text-muted-foreground'}`}
                    >
                      {formatCurrency(plan.impagado)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead className="text-muted-foreground">Cuota</TableHead>
                      <TableHead className="text-muted-foreground">Vencimiento</TableHead>
                      <TableHead className="text-muted-foreground">Importe</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.cuotas.map((q) => (
                      <TableRow key={q.numero} className="border-border">
                        <TableCell className="text-foreground">#{q.numero}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {q.vencimiento ? formatDate(q.vencimiento) : '—'}
                        </TableCell>
                        <TableCell className="text-foreground">{formatCurrency(q.bruto)}</TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                              q.estado === 'collected'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : q.estado === 'overdue'
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-zinc-500/20 text-muted-foreground'
                            }`}
                          >
                            {q.estado === 'collected'
                              ? 'Cobrada'
                              : q.estado === 'overdue'
                                ? 'Impago'
                                : 'Por recolectar'}
                          </span>
                          {q.morosa && <span className="ml-1 text-[10px] text-red-400">(marcada morosa)</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {plan.fuente === 'prevision' && plan.cuotas.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-2">
                  Previsión según plan de pago y cobros registrados (sin calendario de cuotas materializado).
                </p>
              )}
              {comisiones.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-xs font-medium text-foreground mb-2">Comisiones de esta venta</p>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border">
                        <TableHead className="text-muted-foreground">Rol</TableHead>
                        <TableHead className="text-muted-foreground">Base (neta)</TableHead>
                        <TableHead className="text-muted-foreground">%</TableHead>
                        <TableHead className="text-muted-foreground">Importe</TableHead>
                        <TableHead className="text-muted-foreground">Estado</TableHead>
                        <TableHead className="text-muted-foreground">Liquidación</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comisiones.map((com) => (
                        <TableRow key={com.id} className="border-border">
                          <TableCell>
                            <Badge variant="secondary">{com.participant_type}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{formatCurrency(com.base_amount)}</TableCell>
                          <TableCell className="text-muted-foreground">{com.percent}%</TableCell>
                          <TableCell
                            className={`font-medium ${com.direction === 'negative' ? 'text-red-400' : 'text-emerald-400'}`}
                          >
                            {com.direction === 'negative' ? '-' : ''}
                            {formatCurrency(com.commission_amount)}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${
                                com.status === 'liquidated'
                                  ? 'bg-emerald-500/20 text-emerald-400'
                                  : com.status === 'approved'
                                    ? 'bg-blue-500/20 text-blue-400'
                                    : com.status === 'cancelled'
                                      ? 'bg-zinc-500/20 text-muted-foreground'
                                      : 'bg-amber-500/20 text-amber-400'
                              }`}
                            >
                              {com.status === 'liquidated'
                                ? 'Liquidada (pagada)'
                                : com.status === 'approved'
                                  ? 'Aprobada'
                                  : com.status === 'cancelled'
                                    ? 'Anulada'
                                    : 'Pendiente'}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs">
                            {com.liquidation_month
                              ? new Date(com.liquidation_month + 'T00:00:00Z').toLocaleDateString('es-ES', {
                                  month: 'long',
                                  year: 'numeric',
                                  timeZone: 'UTC',
                                })
                              : '—'}
                            <span className="block text-[10px]">generada {formatDate(com.created_at)}</span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ))}
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
