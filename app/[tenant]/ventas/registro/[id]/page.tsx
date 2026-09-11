"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Plus, Trash2, CheckCircle, RotateCcw, PhoneCall, FileText, ExternalLink, CreditCard, Pencil } from 'lucide-react'
import { formatDate, formatCurrency, formatPercent } from '@/lib/utils'
import { ContractSection } from '@/components/sales/ContractSection'
import { DocumentVerificationSection } from '@/components/sales/DocumentVerificationSection'
import { toast } from 'sonner'
import type { SaleWithRelations, Collection, SaleExpectedInstallment, Commission, AuditLog, SaleStatus, CommissionRule } from '@/lib/types/database'
import { useTenant, useTenantId } from '@/lib/tenant-context'

type AppointmentCallInfo = {
  recording_url: string | null
  transcript_drive_url: string | null
  ai_summary: string | null
  ai_call_score: number | null
  ai_lead_score: number | null
}

const DEFAULT_COMMISSION_PERCENT: Record<'setter' | 'closer', number> = {
  setter: 5,
  closer: 10,
}

const STATUS_COLORS: Record<SaleStatus, string> = {
  // Verde = dinero cobrado, coherente con la categoría "Comprado" del calendario de citas.
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  refunded: 'bg-red-500/20 text-red-400 border-red-500/30',
  partial_refund: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  chargeback: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled: 'bg-zinc-500/20 text-muted-foreground border-border/30',
}

const STATUS_LABELS: Record<SaleStatus, string> = {
  active: 'Activa',
  refunded: 'Devuelta',
  partial_refund: 'Dev. Parcial',
  chargeback: 'Chargeback',
  cancelled: 'Cancelada',
}

const COMMISSION_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-400',
  approved: 'bg-blue-500/20 text-blue-400',
  liquidated: 'bg-emerald-500/20 text-emerald-400',
  cancelled: 'bg-zinc-500/20 text-muted-foreground',
}

export default function SaleDetailPage({ params }: { params: { id: string } }) {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const { id } = params
  const router = useRouter()
  const [sale, setSale] = useState<SaleWithRelations | null>(null)
  const [collections, setCollections] = useState<Collection[]>([])
  const [installments, setInstallments] = useState<SaleExpectedInstallment[]>([])
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [appointmentCall, setAppointmentCall] = useState<AppointmentCallInfo | null>(null)
  const [commissionRules, setCommissionRules] = useState<CommissionRule[]>([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showRefundDialog, setShowRefundDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [teamUsers, setTeamUsers] = useState<{ id: string; full_name: string; role: string }[]>([])
  const [editForm, setEditForm] = useState({
    setter_id: 'none', closer_id: 'none', affiliate_id: 'none',
    affiliate_commission_percent: '', sale_date: '', gross_amount: '', status: 'active', notes: '',
  })
  const [refundAmount, setRefundAmount] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [refundOverride, setRefundOverride] = useState(false)
  const [refundSubmitting, setRefundSubmitting] = useState(false)
  const [editColl, setEditColl] = useState<Collection | null>(null)
  const [editCollForm, setEditCollForm] = useState({ gross_amount: '', collected_at: '', payment_method: '' })
  const [collSaving, setCollSaving] = useState(false)
  const [deleteColl, setDeleteColl] = useState<Collection | null>(null)
  const [collDeleting, setCollDeleting] = useState(false)
  const [approvingCollId, setApprovingCollId] = useState<string | null>(null)
  const [followUps, setFollowUps] = useState<{ id: string; note: string; created_at: string; author: string }[]>([])
  const [loadingFollowUps, setLoadingFollowUps] = useState(true)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const fetchFollowUps = useCallback(async () => {
    setLoadingFollowUps(true)
    const res = await fetch(`/api/${tenant}/evergreen/sales/${id}/follow-ups`)
    const data = await res.json()
    if (res.ok) setFollowUps(data.notes || [])
    setLoadingFollowUps(false)
  }, [id])

  useEffect(() => {
    fetchFollowUps()
  }, [fetchFollowUps])

  const handleAddNote = async () => {
    if (!newNote.trim()) return
    setSavingNote(true)
    const res = await fetch(`/api/${tenant}/evergreen/sales/${id}/follow-ups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: newNote.trim() }),
    })
    const data = await res.json()
    setSavingNote(false)
    if (!res.ok) { toast.error(data.error || 'Error al guardar la nota'); return }
    setNewNote('')
    fetchFollowUps()
  }

  const fetchData = useCallback(async () => {
    const supabase = createClient()

    const [saleRes, collectionsRes, installmentsRes, commissionsRes, auditRes, rulesRes, userRes, usersRes] = await Promise.all([
      supabase
        .from('sales')
        .select(`*, contacts(*), products(*), payment_plans(*), setter:setter_id(id, full_name), closer:closer_id(id, full_name), affiliate:affiliate_id(id, full_name)`)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single(),
      supabase.from('collections').select('*').eq('sale_id', id).eq('tenant_id', tenantId).order('collected_at', { ascending: false }),
      supabase.from('sale_expected_installments').select('*').eq('sale_id', id).eq('tenant_id', tenantId).order('installment_number'),
      // Desambiguar el embed: commissions tiene 2 FK a users (user_id y approved_by) → PGRST201 si no
      supabase.from('commissions').select('*, users!commissions_user_id_fkey(full_name)').eq('sale_id', id).eq('tenant_id', tenantId),
      supabase.from('audit_logs').select('*').eq('entity_id', id).eq('tenant_id', tenantId).order('created_at', { ascending: false }),
      supabase.from('commission_rules').select('*').eq('is_active', true).eq('tenant_id', tenantId),
      supabase.auth.getUser(),
      supabase.from('users').select('id, full_name, roles(key)').eq('is_active', true),
    ])

    if (saleRes.error) {
      toast.error('Venta no encontrada')
      router.push(`/${tenant}/ventas/registro`)
      return
    }

    // Sin esto, un fallo de RLS en collections/installments/commissions dejaba "Total cobrado"
    // en 0€ en silencio, indistinguible de una venta sin cobros reales.
    if (collectionsRes.error) toast.error('Error al cargar los cobros', { description: collectionsRes.error.message })
    if (installmentsRes.error) toast.error('Error al cargar las cuotas', { description: installmentsRes.error.message })
    if (commissionsRes.error) toast.error('Error al cargar las comisiones', { description: commissionsRes.error.message })

    const saleData = saleRes.data as SaleWithRelations
    setSale(saleData)
    setTeamUsers(
      ((usersRes.data ?? []) as { id: string; full_name: string; roles?: { key?: string } }[])
        .map((u) => ({ id: u.id, full_name: u.full_name, role: u.roles?.key ?? '' }))
    )
    setCollections(collectionsRes.data ?? [])
    setInstallments(installmentsRes.data ?? [])
    setCommissions(commissionsRes.data ?? [])
    setAuditLogs(auditRes.data ?? [])
    setCommissionRules(rulesRes.data ?? [])
    setLoading(false)

    // Fetch appointment call info (grabación, transcripción, análisis IA)
    if (saleData?.appointment_id) {
      const { data: apptData } = await supabase
        .from('appointments')
        .select('recording_url, transcript_drive_url, ai_summary, ai_call_score, ai_lead_score')
        .eq('id', saleData.appointment_id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      setAppointmentCall(apptData as AppointmentCallInfo | null)
    } else {
      setAppointmentCall(null)
    }

    // Fetch user role
    if (userRes.data.user) {
      const { data: userData } = await supabase
        .from('users')
        .select('roles(key)')
        .eq('id', userRes.data.user.id)
        .single()
      const roleKey = (userData as { roles?: { key?: string } } | null)?.roles?.key ?? null
      setUserRole(roleKey)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tenantId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleDelete = async () => {
    // Server-side: borra comisiones/devoluciones/cobros en el orden correcto (el delete directo
    // desde el cliente fallaba por violación de FK en cuanto la venta tenía algún cobro/comisión).
    // La agenda que originó la venta NO se toca.
    const res = await fetch(`/api/${tenant}/evergreen/sales/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saleId: id }),
    })
    const data = await res.json()
    if (!res.ok) { toast.error(data.error || 'Error al eliminar'); return }
    toast.success('Venta eliminada')
    // Cierra el AlertDialog ANTES de navegar: si se navega con el diálogo aún "open", Radix
    // deja <body style="pointer-events:none"> aplicado (bloqueo de scroll del modal) y no se
    // limpia al desmontar vía router.push, dejando la página de Ventas con los filtros y
    // controles bloqueados hasta recargar.
    setShowDeleteDialog(false)
    router.push(`/${tenant}/ventas/registro`)
  }

  const openEditDialog = () => {
    if (!sale) return
    setEditForm({
      setter_id: sale.setter_id ?? 'none',
      closer_id: sale.closer_id ?? 'none',
      affiliate_id: sale.affiliate_id ?? 'none',
      affiliate_commission_percent: sale.affiliate_commission_percent != null ? String(sale.affiliate_commission_percent) : '',
      sale_date: sale.sale_date ?? '',
      gross_amount: String(sale.gross_amount ?? ''),
      status: sale.status ?? 'active',
      notes: sale.notes ?? '',
    })
    setShowEditDialog(true)
  }

  const handleEditSubmit = async () => {
    if (!sale) return
    setEditSaving(true)
    // Endpoint central: actualiza la venta y RECONCILIA las comisiones con los cobros reales.
    // Así, al asignar/cambiar el comercial, se generan al instante las comisiones de lo ya cobrado
    // (y se limpian las del rep anterior). No hacemos el update directo desde el cliente para que
    // la reconciliación se ejecute siempre en el servidor con service-role.
    const res = await fetch(`/api/${tenant}/evergreen/sales/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        saleId: id,
        setter_id: editForm.setter_id,
        closer_id: editForm.closer_id,
        affiliate_id: editForm.affiliate_id,
        affiliate_commission_percent: editForm.affiliate_commission_percent,
        sale_date: editForm.sale_date || sale.sale_date,
        gross_amount: editForm.gross_amount || sale.gross_amount,
        status: editForm.status,
        notes: editForm.notes,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error('Error al guardar', { description: data?.error })
      setEditSaving(false)
      return
    }
    if (data.created > 0 || data.deleted > 0) {
      toast.success(`Venta actualizada — comisiones recalculadas (${data.created} nuevas, ${data.deleted} sustituidas)`)
    } else {
      toast.success('Venta actualizada')
    }
    setShowEditDialog(false)
    setEditSaving(false)
    fetchData()
  }

  const markInstallmentPaid = async (installment: SaleExpectedInstallment) => {
    // Usa el endpoint central: registra el cobro y GENERA las comisiones (pendientes).
    const res = await fetch(`/api/${tenant}/evergreen/payments/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installmentId: installment.id, action: 'paid' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data?.error || 'Error al registrar el pago')
      return
    }
    if (data.already) {
      toast.info('Esta cuota ya estaba cobrada — no se ha duplicado el cobro')
    } else if (data.monitoring) {
      toast.success('Cuota (monitorización) marcada como pagada')
    } else if (data.commissionsGenerated > 0) {
      toast.success(`Pago registrado — ${data.commissionsGenerated} comisión(es) generada(s)`)
    } else {
      toast.success('Pago registrado correctamente')
    }
    fetchData()
  }

  const openEditCollection = (c: Collection) => {
    setEditColl(c)
    setEditCollForm({
      gross_amount: String(c.gross_amount ?? ''),
      collected_at: c.collected_at ? c.collected_at.slice(0, 10) : '',
      payment_method: c.payment_method ?? '',
    })
  }

  const handleApproveCollectionReview = async (collectionId: string) => {
    setApprovingCollId(collectionId)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/collections/approve-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error('Error al aprobar el cobro', { description: data?.error })
        return
      }
      toast.success('Cobro aprobado: comisión generada')
      fetchData()
    } finally {
      setApprovingCollId(null)
    }
  }

  const handleEditCollectionSubmit = async () => {
    if (!editColl) return
    setCollSaving(true)
    const res = await fetch(`/api/${tenant}/evergreen/collections/${editColl.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gross_amount: editCollForm.gross_amount,
        collected_at: editCollForm.collected_at || undefined,
        payment_method: editCollForm.payment_method,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setCollSaving(false)
    if (!res.ok) { toast.error(data?.error || 'Error al editar el cobro'); return }
    toast.success('Cobro actualizado — comisiones reconciliadas')
    setEditColl(null)
    fetchData()
  }

  const handleDeleteCollection = async () => {
    if (!deleteColl) return
    setCollDeleting(true)
    const res = await fetch(`/api/${tenant}/evergreen/collections/${deleteColl.id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    setCollDeleting(false)
    if (!res.ok) { toast.error(data?.error || 'Error al eliminar el cobro'); return }
    toast.success('Cobro eliminado — comisiones reconciliadas')
    setDeleteColl(null)
    fetchData()
  }

  // Comisión esperada (setter/closer) cuando aún no hay comisiones reales generadas
  const expectedCommissions = useMemo(() => {
    if (!sale || !sale.payment_plans) return []

    const findRule = (participantType: 'setter' | 'closer', userId: string | null): CommissionRule | null => {
      if (!userId) return null
      const rulesForType = commissionRules.filter(r => r.participant_type === participantType)
      // Prioriza regla específica del usuario, si no, regla genérica (user_id null)
      const userRule = rulesForType.find(r => r.user_id === userId)
      if (userRule) return userRule
      const genericRule = rulesForType.find(r => !r.user_id)
      return genericRule ?? null
    }

    // Base de comisión esperada: debe salir de lo comisionable (expected_commissionable_amount),
    // no del bruto — de lo contrario el % mostrado antes de cobrar no coincide con la comisión real
    // que se genera al cobrar (que sí usa collection.commissionable_amount).
    const cashCollectionRatio = sale.payment_plans.cash_collection_ratio ?? 1
    const commissionableBase = sale.expected_commissionable_amount ?? sale.gross_amount
    const baseAmount = commissionableBase * cashCollectionRatio

    const rows: { role: 'setter' | 'closer'; userId: string; userName: string; percent: number; baseAmount: number; commissionAmount: number }[] = []

    if (sale.setter_id) {
      const rule = findRule('setter', sale.setter_id)
      const percent = rule?.percent ?? DEFAULT_COMMISSION_PERCENT.setter
      rows.push({
        role: 'setter',
        userId: sale.setter_id,
        userName: sale.setter?.full_name ?? '—',
        percent,
        baseAmount,
        commissionAmount: baseAmount * (percent / 100),
      })
    }

    if (sale.closer_id) {
      const rule = findRule('closer', sale.closer_id)
      const percent = rule?.percent ?? DEFAULT_COMMISSION_PERCENT.closer
      rows.push({
        role: 'closer',
        userId: sale.closer_id,
        userName: sale.closer?.full_name ?? '—',
        percent,
        baseAmount,
        commissionAmount: baseAmount * (percent / 100),
      })
    }

    return rows
  }, [sale, commissionRules])

  const hasRealCommissions = commissions.length > 0

  const isAdminOrDirector = userRole === 'admin' || userRole === 'director'
  // Aprobar cuotas en revisión (plan personalizado): mismo alcance que payments/mark (cobros incluido).
  const canApproveReview = isAdminOrDirector || userRole === 'cobros'

  const isReservation = sale?.payment_plans?.method === 'reserva'

  const isOutOfRefundWindow = sale?.refund_deadline_at
    ? new Date(sale.refund_deadline_at) < new Date()
    : false

  const openRefundDialog = () => {
    setRefundAmount('')
    setRefundReason('')
    setRefundOverride(false)
    setShowRefundDialog(true)
  }

  const handleRefundSubmit = async () => {
    if (!sale) return
    setRefundSubmitting(true)
    try {
      const trimmedAmount = refundAmount.trim()
      const parsedAmount = trimmedAmount ? Number(trimmedAmount) : undefined

      if (trimmedAmount && (isNaN(parsedAmount as number) || (parsedAmount as number) <= 0)) {
        toast.error('El importe debe ser un número válido')
        setRefundSubmitting(false)
        return
      }

      const res = await fetch(`/api/${tenant}/evergreen/refunds/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleId: id,
          grossRefundAmount: parsedAmount,
          reason: refundReason,
          override: refundOverride,
        }),
      })

      const data = await res.json()

      if (res.status === 422 && data?.outOfWindow) {
        toast.error("Fuera del plazo de 15 días. Marca 'Forzar' si quieres devolverla igualmente.")
        setRefundSubmitting(false)
        return
      }

      if (!res.ok) {
        toast.error(data?.error || 'Error al registrar la devolución')
        setRefundSubmitting(false)
        return
      }

      toast.success(`Devolución registrada — se han restado ${data.negativeCommissions} comisiones`)
      setShowRefundDialog(false)
      fetchData()
    } catch {
      toast.error('Error al registrar la devolución')
    } finally {
      setRefundSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-card rounded animate-pulse" />
        <div className="h-32 bg-card rounded-lg animate-pulse" />
      </div>
    )
  }

  if (!sale) return null

  const totalCollected = collections.reduce((sum, c) => sum + c.gross_amount, 0)

  // Cobros duplicados: 2+ cobros (no revertidos) para la misma cuota esperada. Marcamos como
  // "duplicado" todos menos el primero (por fecha) de cada cuota, para que el admin los elimine.
  const duplicateCollectionIds = (() => {
    const byInstallment = new Map<string, Collection[]>()
    for (const c of collections) {
      if (!c.expected_installment_id || c.status === 'reversed') continue
      const arr = byInstallment.get(c.expected_installment_id) ?? []
      arr.push(c)
      byInstallment.set(c.expected_installment_id, arr)
    }
    const dupes = new Set<string>()
    for (const arr of Array.from(byInstallment.values())) {
      if (arr.length < 2) continue
      arr
        .slice()
        .sort((a, b) => new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime())
        .slice(1)
        .forEach((c) => dupes.add(c.id))
    }
    return dupes
  })()

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground" onClick={() => router.back()}>
        <ArrowLeft className="w-4 h-4 mr-2" />
        Volver
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-foreground">{sale.contacts?.full_name}</h1>
            <Badge className={`border ${STATUS_COLORS[sale.status]}`}>{STATUS_LABELS[sale.status]}</Badge>
          </div>
          <p className="text-muted-foreground">{sale.payment_plans?.name} — {formatCurrency(sale.gross_amount)}</p>
        </div>
        {isReservation && (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-foreground"
            onClick={() => router.push(`/${tenant}/ventas/registro/nueva?contact=${sale.contact_id}&reserva=${sale.reservation_amount ?? sale.gross_amount}&product=${sale.product_id}&reservationId=${sale.id}`)}
          >
            <CreditCard className="w-4 h-4 mr-2" />
            Completar pago
          </Button>
        )}
        {isAdminOrDirector && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 border border-blue-500/30"
              onClick={openEditDialog}
            >
              <Pencil className="w-4 h-4 mr-2" />
              Editar
            </Button>
            {sale.status !== 'refunded' && (
              <Button
                variant="ghost"
                size="sm"
                className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 border border-amber-500/30"
                onClick={openRefundDialog}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Devolver
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-red-500/30"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Eliminar Venta
            </Button>
          </div>
        )}
      </div>

      {/* Aviso de conflicto de atribución (primer toque ≠ último). Se aplicó el último; el admin confirma. */}
      {sale.attribution_conflict && (() => {
        const meta = (sale.attribution_meta ?? {}) as { setter?: { first?: string | null; applied?: string | null; conflict?: boolean }; affiliate?: { first?: string | null; applied?: string | null; conflict?: boolean } }
        const nameOf = (uid?: string | null) => {
          if (!uid) return '—'
          if (uid === sale.setter?.id) return sale.setter?.full_name ?? uid
          if (uid === sale.affiliate?.id) return sale.affiliate?.full_name ?? uid
          const u = teamUsers.find((x) => x.id === uid)
          return u?.full_name ?? uid
        }
        return (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <p className="font-semibold mb-1">⚠️ Conflicto de atribución — revisar</p>
            <p className="text-amber-200/90 text-xs">
              El primer contacto y el último son de reps distintos. Se aplicó el <b>último</b> toque (regla por defecto).
              {meta.setter?.conflict && <> Setter: primer toque <b>{nameOf(meta.setter.first)}</b> · aplicado <b>{nameOf(meta.setter.applied)}</b>.</>}
              {meta.affiliate?.conflict && <> Afiliado: primer toque <b>{nameOf(meta.affiliate.first)}</b> · aplicado <b>{nameOf(meta.affiliate.applied)}</b>.</>}
              {' '}Pulsa <b>Editar</b> para confirmar o cambiar quién se lleva la comisión (se recalcula sola).
            </p>
          </div>
        )
      })()}

      {/* Tabs */}
      <Tabs defaultValue="detail">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="detail">Detalle</TabsTrigger>
          <TabsTrigger value="collections">
            Cobros {collections.length > 0 && <span className="ml-1 text-xs bg-muted px-1.5 rounded-full">{collections.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="installments">
            Cuotas {installments.length > 0 && <span className="ml-1 text-xs bg-muted px-1.5 rounded-full">{installments.length}</span>}
          </TabsTrigger>
          {isAdminOrDirector && (
            <TabsTrigger value="commissions">
              Comisiones {commissions.length > 0 && <span className="ml-1 text-xs bg-muted px-1.5 rounded-full">{commissions.length}</span>}
            </TabsTrigger>
          )}
          <TabsTrigger value="seguimiento">
            Seguimiento{followUps.length > 0 ? ` (${followUps.length})` : ''}
          </TabsTrigger>
          <TabsTrigger value="history">Historial</TabsTrigger>
        </TabsList>

        {/* Detalle */}
        <TabsContent value="detail" className="mt-4">
          <div className="bg-card border border-border rounded-lg p-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: 'Contacto', value: sale.contacts?.full_name },
                { label: 'Email', value: sale.contacts?.email ?? '—' },
                { label: 'Teléfono', value: sale.contacts?.phone ?? '—' },
                { label: 'Fecha de venta', value: formatDate(sale.sale_date) },
                { label: 'Producto', value: sale.products?.name },
                { label: 'Plan de pago', value: sale.payment_plans?.name },
                { label: 'Importe bruto', value: formatCurrency(sale.gross_amount) },
                { label: 'Comisionable', value: formatCurrency(sale.expected_commissionable_amount) },
                { label: 'Total cobrado', value: formatCurrency(totalCollected) },
                { label: 'Plazo devolucion', value: formatDate(sale.refund_deadline_at) },
                { label: 'Setter', value: sale.setter?.full_name ?? '—' },
                { label: 'Closer', value: sale.closer?.full_name ?? '—' },
                { label: 'Afiliado', value: sale.affiliate?.full_name ?? '—' },
                { label: 'Comision afiliado', value: sale.affiliate_commission_percent ? formatPercent(sale.affiliate_commission_percent) : '—' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground mb-1">{label}</dt>
                  <dd className="text-sm text-foreground font-medium">{value}</dd>
                </div>
              ))}
            </dl>
            {sale.notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <dt className="text-xs text-muted-foreground mb-1">Notas</dt>
                <dd className="text-sm text-foreground">{sale.notes}</dd>
              </div>
            )}
            {sale.payment_proof_url && (
              <div className="mt-4 pt-4 border-t border-border">
                <dt className="text-xs text-muted-foreground mb-1">Justificante de pago</dt>
                <dd>
                  <a href={sale.payment_proof_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300">
                    <FileText className="w-3.5 h-3.5" /> Ver justificante <ExternalLink className="w-3 h-3" />
                  </a>
                </dd>
              </div>
            )}
            {sale.buyer_is_scheduler === false && sale.payer_data && (
              <div className="mt-4 pt-4 border-t border-border">
                <dt className="text-xs text-muted-foreground mb-1">Tomador / pagador ({sale.payer_data.relation ?? 'otro'})</dt>
                <dd className="text-sm text-foreground">
                  {sale.payer_data.name}
                  {sale.payer_data.dni ? ` · ${sale.payer_data.dni}` : ''}
                  {sale.payer_data.email ? ` · ${sale.payer_data.email}` : ''}
                  {sale.access_email ? <span className="block text-xs text-muted-foreground mt-0.5">Accesos → {sale.access_email}</span> : null}
                </dd>
              </div>
            )}
          </div>

          {/* Verificación de documentos (cortafuegos antes de poder enviar el contrato) */}
          <div className="bg-card border border-border rounded-lg p-6 mt-4">
            <DocumentVerificationSection
              saleId={id}
              contactCountry={null}
              contactEmail={sale.contacts?.email ?? null}
              userRole={userRole}
            />
          </div>

          {/* Contrato del alumno (firma + onboarding) */}
          <ContractSection saleId={id} />

          {/* Llamada asociada */}
          {sale.appointment_id && (
            <div className="bg-card border border-border rounded-lg p-6 mt-4">
              <div className="flex items-center gap-2 mb-4">
                <PhoneCall className="w-4 h-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">Llamada asociada</h3>
              </div>

              {appointmentCall ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-3">
                    {appointmentCall.recording_url ? (
                      <a
                        href={appointmentCall.recording_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 border border-blue-500/30 bg-blue-500/10 rounded-md px-3 py-1.5"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        Grabación de la llamada
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin grabación disponible</span>
                    )}

                    {appointmentCall.transcript_drive_url ? (
                      <a
                        href={appointmentCall.transcript_drive_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 rounded-md px-3 py-1.5"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Transcripción (Drive)
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">Sin transcripción disponible</span>
                    )}
                  </div>

                  {(appointmentCall.ai_call_score != null || appointmentCall.ai_lead_score != null) && (
                    <div className="flex gap-4">
                      {appointmentCall.ai_call_score != null && (
                        <div>
                          <dt className="text-xs text-muted-foreground mb-1">Puntuación de la llamada (IA)</dt>
                          <dd className="text-sm text-foreground font-medium">{appointmentCall.ai_call_score}</dd>
                        </div>
                      )}
                      {appointmentCall.ai_lead_score != null && (
                        <div>
                          <dt className="text-xs text-muted-foreground mb-1">Puntuación del lead (IA)</dt>
                          <dd className="text-sm text-foreground font-medium">{appointmentCall.ai_lead_score}</dd>
                        </div>
                      )}
                    </div>
                  )}

                  {appointmentCall.ai_summary && (
                    <div>
                      <dt className="text-xs text-muted-foreground mb-1">Resumen IA (puntos de dolor, miedos, deseos)</dt>
                      <dd className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{appointmentCall.ai_summary}</dd>
                    </div>
                  )}

                  {!appointmentCall.ai_summary && appointmentCall.ai_call_score == null && appointmentCall.ai_lead_score == null && (
                    <p className="text-xs text-muted-foreground">Aún no hay análisis IA para esta llamada.</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No se encontró información de la agenda asociada.</p>
              )}
            </div>
          )}
        </TabsContent>

        {/* Cobros */}
        <TabsContent value="collections" className="mt-4">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-muted-foreground">
              Total cobrado: <span className="text-foreground font-medium">{formatCurrency(totalCollected)}</span>
              {' '}<span className="text-muted-foreground">/ facturado {formatCurrency(sale.gross_amount)}</span>
            </p>
            <Button size="sm" onClick={() => router.push(`/${tenant}/finanzas/cobros/cobros/new?saleId=${sale.id}`)}>
              <Plus className="w-4 h-4 mr-2" />
              Registrar cobro
            </Button>
          </div>
          {duplicateCollectionIds.size > 0 && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <p className="font-semibold mb-0.5">⚠️ Cobros duplicados detectados</p>
              <p className="text-red-300/90 text-xs">
                Hay {duplicateCollectionIds.size} cobro(s) que repiten la misma cuota. Elimina los sobrantes con el botón 🗑 de cada fila; las comisiones se recalcularán solas.
              </p>
            </div>
          )}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground">Fecha</TableHead>
                  <TableHead className="text-muted-foreground">Bruto</TableHead>
                  <TableHead className="text-muted-foreground">Comisionable</TableHead>
                  <TableHead className="text-muted-foreground">Metodo</TableHead>
                  <TableHead className="text-muted-foreground">Elegible</TableHead>
                  <TableHead className="text-muted-foreground">Estado</TableHead>
                  {(isAdminOrDirector || canApproveReview) && <TableHead className="text-muted-foreground">Acciones</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {collections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={(isAdminOrDirector || canApproveReview) ? 7 : 6} className="text-center py-8 text-muted-foreground">No hay cobros registrados</TableCell>
                  </TableRow>
                ) : collections.map((c) => {
                  const isDupe = duplicateCollectionIds.has(c.id)
                  return (
                  <TableRow key={c.id} className={`border-border ${isDupe ? 'bg-red-500/5' : ''}`}>
                    <TableCell className="text-foreground text-sm">
                      {formatDate(c.collected_at)}
                      {isDupe && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-300">duplicado</span>}
                    </TableCell>
                    <TableCell className="text-foreground font-medium">{formatCurrency(c.gross_amount)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatCurrency(c.commissionable_amount)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.payment_method || '—'}</TableCell>
                    <TableCell>
                      {c.is_eligible_for_commission ? (
                        <Badge variant="success">Si</Badge>
                      ) : c.needs_commission_review ? (
                        <Badge variant="secondary" className="bg-blue-500/15 text-blue-400">En revisión</Badge>
                      ) : (
                        <Badge variant="secondary">No</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={c.status === 'collected' ? 'success' : 'secondary'}>{c.status}</Badge>
                    </TableCell>
                    {(isAdminOrDirector || canApproveReview) && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {c.needs_commission_review && canApproveReview && (
                            <Button
                              size="sm" variant="outline"
                              className="h-7 text-xs text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
                              title="Aprobar comisión de esta cuota"
                              disabled={approvingCollId === c.id}
                              onClick={() => handleApproveCollectionReview(c.id)}
                            >
                              {approvingCollId === c.id ? 'Aprobando...' : 'Aprobar'}
                            </Button>
                          )}
                          {isAdminOrDirector && (
                            <>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                                title="Editar cobro"
                                onClick={() => openEditCollection(c)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                title="Eliminar cobro"
                                onClick={() => setDeleteColl(c)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Cuotas */}
        <TabsContent value="installments" className="mt-4">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground">Cuota</TableHead>
                  <TableHead className="text-muted-foreground">Vencimiento</TableHead>
                  <TableHead className="text-muted-foreground">Bruto</TableHead>
                  <TableHead className="text-muted-foreground">Comisionable</TableHead>
                  <TableHead className="text-muted-foreground">Estado</TableHead>
                  {isAdminOrDirector && <TableHead className="text-muted-foreground">Accion</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {installments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={isAdminOrDirector ? 6 : 5} className="text-center py-8 text-muted-foreground">Sin cuotas pendientes</TableCell>
                  </TableRow>
                ) : installments.map((inst) => (
                  <TableRow key={inst.id} className="border-border">
                    <TableCell className="text-foreground">#{inst.installment_number}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(inst.due_date)}</TableCell>
                    <TableCell className="text-foreground">{formatCurrency(inst.expected_gross_amount)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatCurrency(inst.expected_commissionable_amount)}
                      {sale?.payment_plans?.method === 'custom' && inst.installment_number > 1 && inst.status !== 'collected' && (
                        <span className="block text-[10px] text-blue-400 mt-0.5">
                          Al cobrarla: revisión manual (no comisiona sola)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        inst.status === 'collected' ? 'success' :
                        inst.status === 'overdue' ? 'destructive' : 'secondary'
                      }>{inst.status}</Badge>
                    </TableCell>
                    {isAdminOrDirector && (
                      <TableCell>
                        {(inst.status === 'pending' || inst.status === 'overdue') && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 border border-emerald-500/30"
                            onClick={() => markInstallmentPaid(inst)}
                          >
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Marcar pagado
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Comisiones — oculto a closers/setters: no deben ver el importe comisionable */}
        {isAdminOrDirector && (
        <TabsContent value="commissions" className="mt-4">
          {!hasRealCommissions && expectedCommissions.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-2">
                Aún no hay comisiones generadas para esta venta (p.ej. pendiente de superar la ventana de devolución). Se muestra la comisión <span className="text-amber-400 font-medium">esperada</span> estimada:
              </p>
              <div className="bg-card border border-amber-500/30 rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead className="text-muted-foreground">Usuario</TableHead>
                      <TableHead className="text-muted-foreground">Tipo</TableHead>
                      <TableHead className="text-muted-foreground">Base</TableHead>
                      <TableHead className="text-muted-foreground">%</TableHead>
                      <TableHead className="text-muted-foreground">Importe</TableHead>
                      <TableHead className="text-muted-foreground">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expectedCommissions.map((ec) => (
                      <TableRow key={`${ec.role}-${ec.userId}`} className="border-border">
                        <TableCell className="text-foreground">{ec.userName}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ec.role}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatCurrency(ec.baseAmount)}</TableCell>
                        <TableCell className="text-muted-foreground">{formatPercent(ec.percent)}</TableCell>
                        <TableCell className="font-medium text-amber-400">{formatCurrency(ec.commissionAmount)}</TableCell>
                        <TableCell>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                            esperada
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground">Usuario</TableHead>
                  <TableHead className="text-muted-foreground">Tipo</TableHead>
                  <TableHead className="text-muted-foreground">Base</TableHead>
                  <TableHead className="text-muted-foreground">%</TableHead>
                  <TableHead className="text-muted-foreground">Importe</TableHead>
                  <TableHead className="text-muted-foreground">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sin comisiones generadas</TableCell>
                  </TableRow>
                ) : commissions.map((com) => (
                  <TableRow key={com.id} className="border-border">
                    <TableCell className="text-foreground">{(com as { users?: { full_name?: string } }).users?.full_name || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{com.participant_type}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatCurrency(com.base_amount)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatPercent(com.percent)}</TableCell>
                    <TableCell className={`font-medium ${com.direction === 'negative' ? 'text-red-400' : 'text-emerald-400'}`}>
                      {com.direction === 'negative' ? '-' : ''}{formatCurrency(com.commission_amount)}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${COMMISSION_STATUS_COLORS[com.status]}`}>
                        {com.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        )}

        {/* Historial */}
        <TabsContent value="seguimiento" className="mt-4 space-y-4">
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <Label className="text-xs text-muted-foreground">Añadir nota de seguimiento</Label>
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Ej: hablé con el cliente, promete pagar el viernes..."
              className="bg-muted border-border min-h-[80px]"
            />
            <div className="flex justify-end">
              <Button onClick={handleAddNote} disabled={savingNote || !newNote.trim()}>
                {savingNote ? 'Guardando...' : 'Añadir nota'}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {loadingFollowUps ? (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            ) : followUps.length === 0 ? (
              <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
                Sin notas de seguimiento todavía.
              </div>
            ) : (
              followUps.map((f) => (
                <div key={f.id} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">{f.author}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(f.created_at)}</span>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{f.note}</p>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-border">
                  <TableHead className="text-muted-foreground">Fecha</TableHead>
                  <TableHead className="text-muted-foreground">Accion</TableHead>
                  <TableHead className="text-muted-foreground">Actor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">Sin historial</TableCell>
                  </TableRow>
                ) : auditLogs.map((log) => (
                  <TableRow key={log.id} className="border-border">
                    <TableCell className="text-muted-foreground text-sm">{formatDate(log.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{log.action}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{log.actor_user_id || 'Sistema'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar venta</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Esta acción no se puede deshacer. La venta de <span className="text-foreground font-medium">{sale.contacts?.full_name}</span> ({formatCurrency(sale.gross_amount)}) será eliminada permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-muted border-border text-foreground hover:bg-muted">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-foreground"
              onClick={handleDelete}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit dialog (admin/director) */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar venta</DialogTitle>
            <DialogDescription>Modifica el equipo, importe, fecha y estado de la venta. Queda registrado en el historial.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Setter</Label>
                <Select value={editForm.setter_id} onValueChange={(v) => setEditForm((f) => ({ ...f, setter_id: v }))}>
                  <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="none">Sin setter</SelectItem>
                    {teamUsers.filter((u) => u.role === 'setter' || u.role === 'cold_caller').map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name}{u.role === 'cold_caller' ? ' (cold caller)' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Closer</Label>
                <Select value={editForm.closer_id} onValueChange={(v) => setEditForm((f) => ({ ...f, closer_id: v }))}>
                  <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="none">Sin closer</SelectItem>
                    {/* Incluye admin: hay admins (ej. [tenant]) que también cierran ventas y deben poder marcarse como closer. */}
                    {teamUsers.filter((u) => u.role === 'closer' || u.role === 'admin').map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Afiliado</Label>
                <Select value={editForm.affiliate_id} onValueChange={(v) => setEditForm((f) => ({ ...f, affiliate_id: v }))}>
                  <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="none">Sin afiliado</SelectItem>
                    {teamUsers.filter((u) => u.role === 'affiliate').map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editForm.affiliate_id !== 'none' && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Comisión afiliado (%)</Label>
                  <Input type="number" min="0" max="100" step="0.1" className="bg-muted border-border"
                    value={editForm.affiliate_commission_percent}
                    onChange={(e) => setEditForm((f) => ({ ...f, affiliate_commission_percent: e.target.value }))} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Fecha de venta</Label>
                <Input type="date" className="bg-muted border-border"
                  value={editForm.sale_date}
                  onChange={(e) => setEditForm((f) => ({ ...f, sale_date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Importe bruto (€)</Label>
                <Input type="number" min="0" step="0.01" className="bg-muted border-border"
                  value={editForm.gross_amount}
                  onChange={(e) => setEditForm((f) => ({ ...f, gross_amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Estado</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    {(Object.keys(STATUS_LABELS) as SaleStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Notas</Label>
              <Textarea className="bg-muted border-border min-h-[70px]"
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="bg-muted border border-border text-foreground hover:bg-muted"
              onClick={() => setShowEditDialog(false)} disabled={editSaving}>Cancelar</Button>
            <Button className="bg-blue-600 hover:bg-blue-700 text-foreground" onClick={handleEditSubmit} disabled={editSaving}>
              {editSaving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund dialog */}
      <Dialog open={showRefundDialog} onOpenChange={setShowRefundDialog}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Marcar devolución</DialogTitle>
            <DialogDescription>
              La devolución se restará automáticamente de la facturación y de las comisiones asociadas a esta venta (se generarán comisiones negativas cuando corresponda).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className={`rounded-md border p-3 text-sm ${isOutOfRefundWindow ? 'border-red-500/30 bg-red-500/10 text-red-400' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'}`}>
              <p className="font-medium">
                Plazo de devolución: {formatDate(sale.refund_deadline_at)}
              </p>
              <p className="mt-0.5">
                {isOutOfRefundWindow ? 'Fuera de plazo — 15 días' : 'En plazo'}
              </p>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Importe a devolver (opcional — vacío = devolución total de lo cobrado: {formatCurrency(totalCollected)})
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder={`${totalCollected}`}
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Motivo</label>
              <Input
                type="text"
                placeholder="Motivo de la devolución"
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
              />
            </div>

            {isOutOfRefundWindow && (
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={refundOverride}
                  onChange={(e) => setRefundOverride(e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-card accent-amber-500"
                />
                Forzar devolución fuera de plazo
              </label>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              className="bg-muted border border-border text-foreground hover:bg-muted"
              onClick={() => setShowRefundDialog(false)}
              disabled={refundSubmitting}
            >
              Cancelar
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-foreground"
              onClick={handleRefundSubmit}
              disabled={refundSubmitting}
            >
              {refundSubmitting ? 'Procesando...' : 'Confirmar devolución'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar cobro (admin/director) */}
      <Dialog open={!!editColl} onOpenChange={(o) => { if (!o) setEditColl(null) }}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle>Editar cobro</DialogTitle>
            <DialogDescription>
              Al cambiar el importe se recalcula el comisionable según el plan y se reconcilian las comisiones de la venta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Importe bruto (€)</Label>
              <Input type="number" min="0" step="0.01" className="bg-muted border-border"
                value={editCollForm.gross_amount}
                onChange={(e) => setEditCollForm((f) => ({ ...f, gross_amount: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Fecha del cobro</Label>
              <Input type="date" className="bg-muted border-border"
                value={editCollForm.collected_at}
                onChange={(e) => setEditCollForm((f) => ({ ...f, collected_at: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Método de pago</Label>
              <Input type="text" className="bg-muted border-border" placeholder="tarjeta, transferencia, sequra..."
                value={editCollForm.payment_method}
                onChange={(e) => setEditCollForm((f) => ({ ...f, payment_method: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="bg-muted border border-border text-foreground hover:bg-muted"
              onClick={() => setEditColl(null)} disabled={collSaving}>Cancelar</Button>
            <Button className="bg-blue-600 hover:bg-blue-700 text-foreground" onClick={handleEditCollectionSubmit} disabled={collSaving}>
              {collSaving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar cobro (admin/director) */}
      <AlertDialog open={!!deleteColl} onOpenChange={(o) => { if (!o) setDeleteColl(null) }}>
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar cobro</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Se eliminará el cobro de {deleteColl ? formatCurrency(deleteColl.gross_amount) : ''} y sus comisiones asociadas. Las comisiones de la venta se recalcularán con los cobros restantes. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-muted border-border text-foreground hover:bg-muted" disabled={collDeleting}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-foreground" onClick={(e) => { e.preventDefault(); handleDeleteCollection() }} disabled={collDeleting}>
              {collDeleting ? 'Eliminando...' : 'Eliminar cobro'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
