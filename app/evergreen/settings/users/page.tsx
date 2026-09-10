"use client"

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { UserPlus, Edit2, Loader2, Users, KeyRound, Copy, Wallet, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ROLE_LABELS, ROLE_COLORS, NAV_PAGES, type AppRole } from '@/lib/auth/permissions'
import { PageAccessSelector } from '@/components/settings/PageAccessSelector'
import type { User, Role, ContractTemplate, CommissionRule } from '@/lib/types/database'
import { formatCurrency } from '@/lib/utils'
import { generateUniqueTrackingCode } from '@/lib/tracking'
import { buildDefaultTerms, type ContractTerms } from '@/lib/contracts/terms'
import { ContractTermsEditor, CONTRACT_ROLES } from '@/components/contracts/ContractTermsEditor'

// Roles que necesitan tracking_code para generar enlaces con UTM
const TRACKING_ROLES: AppRole[] = ['setter', 'closer', 'cold_caller', 'affiliate']

type UserWithRole = User & { roles: Role }

export default function UsersPage() {
  const [users, setUsers] = useState<UserWithRole[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteDialog, setInviteDialog] = useState(false)
  const [editDialog, setEditDialog] = useState(false)
  const [editingUser, setEditingUser] = useState<UserWithRole | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resettingId, setResettingId] = useState<string | null>(null)
  const [resetResult, setResetResult] = useState<{ name: string; password: string } | null>(null)
  const [inviteResult, setInviteResult] = useState<{ email: string; url: string; emailed: boolean; emailError: string | null } | null>(null)
  const [generatingSalaries, setGeneratingSalaries] = useState(false)
  const [regeneratingAll, setRegeneratingAll] = useState(false)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePersonalEmail, setInvitePersonalEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('')
  const [inviteFullName, setInviteFullName] = useState('')
  const [invitePageOverrides, setInvitePageOverrides] = useState<string[]>([])
  // Contrato opcional al invitar
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [rules, setRules] = useState<CommissionRule[]>([])
  const [sendContract, setSendContract] = useState(false)
  const [contractRoleKey, setContractRoleKey] = useState<AppRole | ''>('')
  const [contractTerms, setContractTerms] = useState<ContractTerms | null>(null)
  const [contractTemplateId, setContractTemplateId] = useState('')
  const [contractTitle, setContractTitle] = useState('')

  // Edit form
  const [editCompanyEmail, setEditCompanyEmail] = useState('')
  const [editPersonalEmail, setEditPersonalEmail] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState('')
  const [editIsActive, setEditIsActive] = useState(true)
  const [editAffiliatePercent, setEditAffiliatePercent] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editDataScope, setEditDataScope] = useState<'own' | 'team'>('team')
  const [editBaseSalary, setEditBaseSalary] = useState('')
  const [editFijoUnlockType, setEditFijoUnlockType] = useState<'none' | 'sales' | 'revenue'>('none')
  const [editFijoThreshold, setEditFijoThreshold] = useState('')
  const [editMonthlyGoal, setEditMonthlyGoal] = useState('')
  const [editAssignedChannel, setEditAssignedChannel] = useState('')
  const [editMemberStatus, setEditMemberStatus] = useState<'activo' | 'inactivo' | 'prueba'>('activo')
  const [editAffiliateCode, setEditAffiliateCode] = useState('')
  const [editPageOverrides, setEditPageOverrides] = useState<string[]>([])
  const [editTrackingCode, setEditTrackingCode] = useState('')
  const [regeneratingCode, setRegeneratingCode] = useState(false)

  const fetchData = async () => {
    const supabase = createClient()
    const [usersRes, rolesRes, tplRes, rulesRes] = await Promise.all([
      supabase.from('users').select('*, roles(*)').order('full_name'),
      supabase.from('roles').select('*').order('name'),
      supabase.from('contract_templates').select('*').eq('is_active', true).order('created_at', { ascending: false }),
      supabase.from('commission_rules').select('*'),
    ])

    setUsers((usersRes.data ?? []) as UserWithRole[])
    setRoles(rolesRes.data ?? [])
    setTemplates((tplRes.data ?? []) as ContractTemplate[])
    setRules((rulesRes.data ?? []) as CommissionRule[])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  // Asegura la columna users.page_overrides (idempotente). Corre en Vercel, donde POSTGRES_URL
  // está poblado; la llamada va autenticada (sesión admin) desde dentro de la app.
  useEffect(() => { fetch('/api/evergreen/admin/migrate-page-overrides', { method: 'POST' }).catch(() => {}) }, [])

  const openEdit = (user: UserWithRole) => {
    setEditingUser(user)
    setEditCompanyEmail(user.email ?? '')
    setEditPersonalEmail((user as { personal_email?: string | null }).personal_email ?? '')
    setEditRole(user.role_id)
    setEditIsActive(user.is_active)
    setEditAffiliatePercent(String(user.default_affiliate_commission_percent ?? ''))
    setEditPhone(user.phone ?? '')
    setEditDataScope(user.data_scope ?? 'team')
    setEditBaseSalary(user.base_salary !== null && user.base_salary !== undefined ? String(user.base_salary) : '')
    {
      const u = user as { fijo_unlock_type?: string | null; fijo_min_sales?: number | null; fijo_min_revenue?: number | null }
      const type = (u.fijo_unlock_type as 'sales' | 'revenue') ?? 'sales'
      const sales = Number(u.fijo_min_sales ?? 0)
      const rev = Number(u.fijo_min_revenue ?? 0)
      if (type === 'revenue' && rev > 0) { setEditFijoUnlockType('revenue'); setEditFijoThreshold(String(rev)) }
      else if (sales > 0) { setEditFijoUnlockType('sales'); setEditFijoThreshold(String(sales)) }
      else { setEditFijoUnlockType('none'); setEditFijoThreshold('') }
    }
    setEditMonthlyGoal(user.monthly_goal !== null && user.monthly_goal !== undefined ? String(user.monthly_goal) : '')
    setEditAssignedChannel(user.assigned_channel ?? '')
    setEditMemberStatus(user.member_status ?? 'activo')
    setEditAffiliateCode(user.affiliate_code ?? '')
    // Muestra las páginas permitidas: usa page_overrides si existe; si no, expande dept_overrides
    // (para que un usuario antiguo restringido por departamento se vea ya marcado por página).
    const pageOv = (user as { page_overrides?: string[] | null }).page_overrides
    const deptOv = (user.dept_overrides as string[] | null) ?? []
    setEditPageOverrides(
      pageOv && pageOv.length ? pageOv
        : deptOv.length ? NAV_PAGES.filter((p) => deptOv.includes(p.dept)).map((p) => p.href)
        : []
    )
    setEditTrackingCode(user.tracking_code ?? '')
    setEditDialog(true)
  }

  // Regenera de golpe el código de tracking de TODO el equipo, sustituyéndolo por uno privado/opaco.
  // Aviso: los enlaces antiguos (con el utm_term viejo) dejan de atribuir hasta recopiar el enlace nuevo.
  const handleRegenerateAllTrackingCodes = async () => {
    const ok = window.confirm(
      'Se generará un código de tracking privado nuevo para todo el equipo.\n\n' +
      'Los enlaces YA compartidos con el código antiguo dejarán de atribuir agendas/ventas hasta que ' +
      'cada persona recopie su enlace desde la sección Enlaces.\n\n¿Continuar?'
    )
    if (!ok) return
    setRegeneratingAll(true)
    try {
      const res = await fetch('/api/evergreen/admin/regenerate-tracking-codes', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error')
      toast.success(`Códigos regenerados: ${json.updated}/${json.total}`, {
        description: 'Recuerda que el equipo debe recopiar sus enlaces desde Enlaces.',
      })
      await fetchData()
    } catch (e) {
      toast.error('No se pudieron regenerar los códigos', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setRegeneratingAll(false)
    }
  }

  const handleRegenerateTrackingCode = async () => {
    if (!editingUser) return
    setRegeneratingCode(true)
    const code = await generateUniqueTrackingCode(createClient(), editingUser.id)
    setEditTrackingCode(code)
    setRegeneratingCode(false)
  }

  // Construye/actualiza las condiciones del contrato para un rol dado. El usuario aún no existe al
  // invitar (id vacío → usa reglas de comisión genéricas del rol); el fijo se edita a mano.
  const recomputeContractTerms = (rk: AppRole) => {
    const roleLabel = ROLE_LABELS[rk] ?? rk
    setContractTerms(buildDefaultTerms({ id: '', base_salary: null, default_affiliate_commission_percent: null }, rk, roleLabel, rules))
    setContractTitle(`Contrato ${roleLabel} — ${inviteFullName || inviteEmail || 'colaborador'}`)
    const match = templates.find((t) => t.role_key === rk) ?? templates[0]
    setContractTemplateId(match?.id ?? '')
  }

  const onToggleSendContract = (checked: boolean) => {
    setSendContract(checked)
    if (checked && !contractTerms) {
      const invitedKey = roles.find((r) => r.id === inviteRole)?.key as AppRole | undefined
      const rk: AppRole = invitedKey && CONTRACT_ROLES.includes(invitedKey) ? invitedKey : 'closer'
      setContractRoleKey(rk)
      recomputeContractTerms(rk)
    }
  }

  const onContractRoleChange = (rk: AppRole) => {
    setContractRoleKey(rk)
    recomputeContractTerms(rk)
  }

  const resetInviteForm = () => {
    setInviteEmail(''); setInvitePersonalEmail(''); setInviteRole(''); setInviteFullName(''); setInvitePageOverrides([])
    setSendContract(false); setContractRoleKey(''); setContractTerms(null); setContractTemplateId(''); setContractTitle('')
  }

  const handleInvite = async () => {
    if (!inviteEmail || !inviteRole) {
      toast.error('Completa el email y el rol')
      return
    }
    if (sendContract && (!contractTerms || !contractRoleKey)) {
      toast.error('Completa las condiciones del contrato o desactiva el envío')
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/evergreen/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, personalEmail: invitePersonalEmail.trim() || null, roleId: inviteRole, fullName: inviteFullName, pageOverrides: invitePageOverrides }),
    })
    const data = await res.json()
    if (!res.ok) {
      setSubmitting(false)
      toast.error('Error al invitar', { description: data.error })
      return
    }
    if (data.emailed) toast.success(`Email de acceso enviado a ${inviteEmail}`)
    else toast.info('Usuario creado. Comparte el enlace de acceso que se muestra.')

    // Contrato opcional: se crea y envía DESPUÉS de crear la cuenta (necesita el userId del invitado).
    if (sendContract && data.userId && contractTerms) {
      const cRes = await fetch('/api/evergreen/contracts/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: data.userId,
          templateId: contractTemplateId || null,
          title: contractTitle,
          terms: contractTerms,
          roleKey: contractRoleKey || null,
          roleLabel: contractRoleKey ? ROLE_LABELS[contractRoleKey] : null,
          personalEmail: invitePersonalEmail.trim() || null,
        }),
      })
      const cData = await cRes.json()
      if (!cRes.ok) {
        toast.error('Usuario invitado, pero el contrato falló', { description: cData.error })
      } else if (cData.emailed) {
        toast.success(`Contrato enviado por email a ${cData.memberEmail}`)
      } else {
        toast.info('Contrato creado (envío por email no disponible). Comparte el enlace desde Contratos → Equipo.')
      }
    } else if (sendContract && !data.userId) {
      toast.error('No se pudo crear el contrato: falta el ID del usuario invitado. Envíalo desde Contratos → Equipo.')
    }

    setSubmitting(false)
    setInviteDialog(false)
    setInviteResult({ email: inviteEmail, url: data.inviteUrl, emailed: !!data.emailed, emailError: data.emailError ?? null })
    resetInviteForm()
    fetchData()
  }

  const handleResetPassword = async (user: UserWithRole) => {
    if (!confirm(`¿Generar una contraseña temporal para ${user.full_name}? La actual dejará de funcionar.`)) return
    setResettingId(user.id)
    const res = await fetch('/api/evergreen/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    })
    const data = await res.json()
    setResettingId(null)
    if (!res.ok) {
      toast.error('No se pudo restablecer', { description: data.error })
      return
    }
    setResetResult({ name: user.full_name, password: data.tempPassword })
  }

  const generateMonthlySalaries = async (): Promise<{ ok: boolean; inserted?: number }> => {
    try {
      const res = await fetch('/api/evergreen/cron/monthly', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        console.warn('No se pudieron actualizar los sueldos del mes', data?.error)
        return { ok: false }
      }
      return { ok: true, inserted: data.inserted }
    } catch (err) {
      console.warn('Error al llamar al cron de sueldos mensuales', err)
      return { ok: false }
    }
  }

  const handleGenerateSalariesClick = async () => {
    setGeneratingSalaries(true)
    const result = await generateMonthlySalaries()
    setGeneratingSalaries(false)
    if (result.ok) {
      toast.success(`Sueldos del mes actualizados (${result.inserted ?? 0} generados)`)
    } else {
      toast.error('No se pudieron generar los sueldos del mes')
    }
  }

  const handleEditUser = async () => {
    if (!editingUser) return
    setSubmitting(true)
    const supabase = createClient()

    // Cambios de correo (empresa/personal) van por el endpoint: el de empresa
    // toca Supabase Auth (login); el personal solo el perfil.
    const newCompanyEmail = editCompanyEmail.trim().toLowerCase()
    const newPersonalEmail = editPersonalEmail.trim().toLowerCase()
    const currentPersonalEmail = ((editingUser as { personal_email?: string | null }).personal_email ?? '').toLowerCase()
    const companyChanged = !!newCompanyEmail && newCompanyEmail !== (editingUser.email ?? '').toLowerCase()
    const personalChanged = newPersonalEmail !== currentPersonalEmail
    if (companyChanged && !newCompanyEmail) {
      setSubmitting(false)
      toast.error('El correo de empresa no puede quedar vacío')
      return
    }
    if (companyChanged || personalChanged) {
      const emRes = await fetch('/api/evergreen/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingUser.id,
          ...(companyChanged ? { companyEmail: newCompanyEmail } : {}),
          ...(personalChanged ? { personalEmail: newPersonalEmail || null } : {}),
        }),
      })
      const emData = await emRes.json()
      if (!emRes.ok) {
        setSubmitting(false)
        toast.error('No se pudieron actualizar los correos', { description: emData.error })
        return
      }
      if (companyChanged) {
        toast.warning('Correo de empresa cambiado', {
          description: 'Actualízalo también en Calendly/GHL (casan por email) para no perder la atribución de agendas.',
          duration: 8000,
        })
      }
    }

    const parsedBaseSalary = editBaseSalary ? parseFloat(editBaseSalary) : null

    // Si el rol destino necesita tracking_code y aún no tiene, lo generamos.
    let trackingCode = editTrackingCode.trim() || null
    const newRoleKey = roles.find((r) => r.id === editRole)?.key as AppRole | undefined
    if (!trackingCode && newRoleKey && TRACKING_ROLES.includes(newRoleKey)) {
      trackingCode = await generateUniqueTrackingCode(supabase, editingUser.id)
    }

    const { error } = await supabase
      .from('users')
      .update({
        role_id: editRole,
        is_active: editIsActive,
        phone: editPhone || null,
        default_affiliate_commission_percent: editAffiliatePercent ? parseFloat(editAffiliatePercent) : null,
        data_scope: editDataScope,
        base_salary: parsedBaseSalary,
        fijo_unlock_type: editFijoUnlockType === 'none' ? 'sales' : editFijoUnlockType,
        fijo_min_sales: editFijoUnlockType === 'sales' && editFijoThreshold ? parseInt(editFijoThreshold, 10) : 0,
        fijo_min_revenue: editFijoUnlockType === 'revenue' && editFijoThreshold ? parseFloat(editFijoThreshold) : 0,
        monthly_goal: editMonthlyGoal ? parseFloat(editMonthlyGoal) : null,
        assigned_channel: editAssignedChannel || null,
        member_status: editMemberStatus,
        affiliate_code: editAffiliateCode || null,
        dept_overrides: null,
        page_overrides: editPageOverrides.length > 0 ? editPageOverrides : null,
        tracking_code: trackingCode,
      })
      .eq('id', editingUser.id)

    setSubmitting(false)

    if (error) {
      toast.error('Error al actualizar el usuario', { description: error.message })
      return
    }

    toast.success('Usuario actualizado')
    setEditDialog(false)
    fetchData()

    if (parsedBaseSalary && parsedBaseSalary > 0) {
      const result = await generateMonthlySalaries()
      if (result.ok) {
        toast.success(`Sueldos del mes actualizados (${result.inserted ?? 0} generados)`)
      }
    }
  }

  const handleDeleteUser = async (user: UserWithRole) => {
    if (!confirm(
      `¿Eliminar a ${user.full_name} definitivamente?\n\n` +
      `Se borrará su acceso (login) y su ficha. Esto NO se puede deshacer.\n` +
      `Si tiene ventas, agendas, comisiones o contratos asociados, se bloqueará ` +
      `y deberás desactivarlo en su lugar.`
    )) return
    setDeletingId(user.id)
    try {
      const res = await fetch(`/api/evergreen/users?userId=${encodeURIComponent(user.id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        toast.error('No se pudo eliminar', { description: data.error, duration: 8000 })
        return
      }
      toast.success(`${user.full_name} eliminado`)
      fetchData()
    } catch (e) {
      toast.error('No se pudo eliminar', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Usuarios</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestiona los miembros del equipo</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handleGenerateSalariesClick}
            disabled={generatingSalaries}
          >
            {generatingSalaries
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generando...</>
              : <><Wallet className="w-4 h-4 mr-2" />Generar sueldos del mes</>}
          </Button>
          <Button
            variant="outline"
            onClick={handleRegenerateAllTrackingCodes}
            disabled={regeneratingAll}
            title="Genera un código de tracking privado para todo el equipo"
          >
            {regeneratingAll
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Regenerando...</>
              : <><RefreshCw className="w-4 h-4 mr-2" />Regenerar códigos</>}
          </Button>
          <Button onClick={() => setInviteDialog(true)}>
            <UserPlus className="w-4 h-4 mr-2" />
            Invitar Usuario
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-4">
        Los sueldos fijos del equipo (campo "Sueldo base mensual") se contabilizan como gasto mensual en la categoría
        Sueldos y aparecen automáticamente en Gastos y en el Resumen financiero.
      </p>

      {loading ? (
        <div className="h-48 bg-card rounded-lg animate-pulse" />
      ) : users.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">No hay usuarios</h3>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Nombre</TableHead>
                <TableHead className="text-muted-foreground">Email</TableHead>
                <TableHead className="text-muted-foreground">Rol</TableHead>
                <TableHead className="text-muted-foreground">Estado</TableHead>
                <TableHead className="text-muted-foreground">Comision Afiliado</TableHead>
                <TableHead className="text-muted-foreground">Sueldo</TableHead>
                <TableHead className="text-muted-foreground">Código tracking</TableHead>
                <TableHead className="text-muted-foreground">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const roleKey = user.roles?.key as AppRole
                return (
                  <TableRow key={user.id} className="border-border">
                    <TableCell className="text-foreground font-medium">{user.full_name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.email}
                      {(user as { personal_email?: string | null }).personal_email && (
                        <span className="block text-xs text-muted-foreground">
                          personal: {(user as { personal_email?: string | null }).personal_email}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {roleKey && (
                        <Badge className={`border text-xs ${ROLE_COLORS[roleKey]}`}>
                          {ROLE_LABELS[roleKey] || roleKey}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.is_active ? 'success' : 'secondary'}>
                        {user.is_active ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.default_affiliate_commission_percent
                        ? `${user.default_affiliate_commission_percent}%`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatCurrency(user.base_salary)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">
                      {user.tracking_code || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(user)}
                          title="Editar"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-amber-400"
                          onClick={() => handleResetPassword(user)}
                          disabled={resettingId === user.id}
                          title="Restablecer contraseña"
                        >
                          {resettingId === user.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <KeyRound className="w-3.5 h-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-400"
                          onClick={() => handleDeleteUser(user)}
                          disabled={deletingId === user.id}
                          title="Eliminar usuario"
                        >
                          {deletingId === user.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Invite Dialog */}
      <Dialog open={inviteDialog} onOpenChange={(o) => { setInviteDialog(o); if (!o) resetInviteForm() }}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invitar Usuario</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Nombre completo</Label>
              <Input
                type="text"
                value={inviteFullName}
                onChange={(e) => setInviteFullName(e.target.value)}
                className="bg-muted border-border"
                placeholder="Nombre Apellido"
              />
            </div>
            <div className="space-y-2">
              <Label>Correo de empresa *</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="bg-muted border-border"
                placeholder="usuario@empresa.com"
              />
              <p className="text-xs text-muted-foreground">Con este entra a la app y se conectan sus calendarios (Calendly/GHL). Se usa para todo salvo el contrato.</p>
            </div>
            <div className="space-y-2">
              <Label>Correo personal (opcional)</Label>
              <Input
                type="email"
                value={invitePersonalEmail}
                onChange={(e) => setInvitePersonalEmail(e.target.value)}
                className="bg-muted border-border"
                placeholder="correo.personal@gmail.com"
              />
              <p className="text-xs text-muted-foreground">Solo para el contrato: recibe copia de la firma. Puedes marcarlo ahora para que el contrato salga a ambos correos.</p>
            </div>
            <div className="space-y-2">
              <Label>Rol *</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Seleccionar rol..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Páginas que puede ver (vacío = según su rol)</Label>
              <PageAccessSelector value={invitePageOverrides} onChange={setInvitePageOverrides} />
              <p className="text-xs text-muted-foreground">Activa/desactiva cada página una a una. Editable después en el usuario.</p>
            </div>

            {/* Contrato opcional: si se activa, al invitar se crea y envía el contrato en un solo paso */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendContract}
                  onChange={(e) => onToggleSendContract(e.target.checked)}
                  className="w-4 h-4 rounded border-border bg-muted accent-sky-500"
                />
                <span className="text-sm text-foreground">Enviar contrato al invitar</span>
              </label>
              {sendContract && templates.length === 0 && (
                <p className="text-xs text-amber-400">No hay plantillas activas. Crea una en Contratos → Plantillas antes de enviar el contrato.</p>
              )}
              {sendContract && (
                <ContractTermsEditor
                  roleKey={contractRoleKey}
                  onRoleChange={onContractRoleChange}
                  terms={contractTerms}
                  onTermsChange={setContractTerms}
                  templateId={contractTemplateId}
                  onTemplateChange={setContractTemplateId}
                  templates={templates}
                  title={contractTitle}
                  onTitleChange={setContractTitle}
                />
              )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => { setInviteDialog(false); resetInviteForm() }} disabled={submitting}>Cancelar</Button>
              <Button onClick={handleInvite} disabled={submitting || !inviteEmail || !inviteRole}>
                {submitting
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Enviando...</>
                  : sendContract ? 'Invitar y enviar contrato' : 'Enviar Invitacion'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset password result Dialog */}
      <Dialog open={!!resetResult} onOpenChange={(o) => !o && setResetResult(null)}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>Contraseña temporal generada</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <p className="text-sm text-muted-foreground">
              Comparte esta contraseña con <span className="text-foreground">{resetResult?.name}</span> por un canal seguro.
              Debería cambiarla al entrar. No se volverá a mostrar.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-emerald-400 font-mono select-all">
                {resetResult?.password}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  if (resetResult?.password) {
                    navigator.clipboard?.writeText(resetResult.password)
                    toast.success('Copiada al portapapeles')
                  }
                }}
                title="Copiar"
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex justify-end pt-1">
              <Button onClick={() => setResetResult(null)}>Hecho</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invite result Dialog — enlace de crear contraseña */}
      <Dialog open={!!inviteResult} onOpenChange={(o) => !o && setInviteResult(null)}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>Invitación creada</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {inviteResult?.emailed ? (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-300">
                ✓ Email para <b>crear contraseña</b> enviado a <span className="text-foreground">{inviteResult.email}</span>.
              </div>
            ) : (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
                {inviteResult?.emailError
                  ? <>No se pudo enviar el email ({inviteResult.emailError}). Comparte este enlace de <b>crear contraseña</b> con el miembro:</>
                  : <>Envío por email no configurado. Comparte este enlace de <b>crear contraseña</b> con el miembro:</>}
              </div>
            )}
            <p className="text-sm text-muted-foreground">Con este enlace crea su contraseña y entra directamente (sin pasar por &quot;he olvidado&quot;).</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted border border-border rounded-lg px-3 py-2.5 text-xs text-brand-300 font-mono break-all select-all">
                {inviteResult?.url}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => {
                  if (inviteResult?.url) {
                    navigator.clipboard?.writeText(inviteResult.url)
                    toast.success('Enlace copiado')
                  }
                }}
                title="Copiar"
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex justify-end pt-1">
              <Button onClick={() => setInviteResult(null)}>Hecho</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialog} onOpenChange={setEditDialog}>
        <DialogContent className="bg-card border-border text-foreground max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Usuario: {editingUser?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Correo de empresa (login)</Label>
              <Input
                type="email"
                value={editCompanyEmail}
                onChange={(e) => setEditCompanyEmail(e.target.value)}
                className="bg-muted border-border"
                placeholder="usuario@empresa.com"
              />
              <p className="text-xs text-muted-foreground">Cambia el login (Supabase Auth) y todo lo demás. Recuerda actualizarlo también en Calendly/GHL.</p>
            </div>
            <div className="space-y-2">
              <Label>Correo personal (contrato)</Label>
              <Input
                type="email"
                value={editPersonalEmail}
                onChange={(e) => setEditPersonalEmail(e.target.value)}
                className="bg-muted border-border"
                placeholder="correo.personal@gmail.com"
              />
              <p className="text-xs text-muted-foreground">Solo para el contrato (firma + copia). Déjalo vacío para no usarlo.</p>
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Telefono</Label>
              <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="bg-muted border-border" placeholder="+34 600 000 000" />
            </div>
            <div className="space-y-2">
              <Label>Comision afiliado por defecto (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={editAffiliatePercent}
                onChange={(e) => setEditAffiliatePercent(e.target.value)}
                className="bg-muted border-border"
                placeholder="10.00"
              />
            </div>
            <div className="space-y-2">
              <Label>Visibilidad de datos</Label>
              <Select value={editDataScope} onValueChange={(v) => setEditDataScope(v as 'own' | 'team')}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="team">Todo el equipo (ve ventas/agendas de todos)</SelectItem>
                  <SelectItem value="own">Solo lo suyo (sus ventas/agendas/contactos)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Admin y director siempre ven todo. La adscripción se controla aparte.</p>
            </div>
            <div className="space-y-2">
              <Label>Sueldo base mensual (€)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editBaseSalary}
                onChange={(e) => setEditBaseSalary(e.target.value)}
                className="bg-muted border-border"
                placeholder="1500.00"
              />
              <p className="text-xs text-muted-foreground">Se contabiliza automáticamente como gasto mensual (categoría Sueldos).</p>
            </div>
            <div className="space-y-2">
              <Label>Condición para desbloquear el fijo</Label>
              <div className="flex gap-2">
                <Select value={editFijoUnlockType} onValueChange={(v) => setEditFijoUnlockType(v as 'none' | 'sales' | 'revenue')}>
                  <SelectTrigger className="bg-muted border-border w-44"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="none">Sin condición</SelectItem>
                    <SelectItem value="sales">Por nº de ventas</SelectItem>
                    <SelectItem value="revenue">Por facturación (€)</SelectItem>
                  </SelectContent>
                </Select>
                {editFijoUnlockType !== 'none' && (
                  <Input
                    type="number"
                    min="0"
                    step={editFijoUnlockType === 'revenue' ? '0.01' : '1'}
                    value={editFijoThreshold}
                    onChange={(e) => setEditFijoThreshold(e.target.value)}
                    className="bg-muted border-border flex-1"
                    placeholder={editFijoUnlockType === 'revenue' ? '5000' : '2'}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Debe alcanzar el mínimo en el mes para cobrar su fijo (lo verá como progreso en su dashboard).
                Una reserva y su pago completado cuentan como 1 venta.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Meta mensual</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={editMonthlyGoal}
                onChange={(e) => setEditMonthlyGoal(e.target.value)}
                className="bg-muted border-border"
                placeholder="10000"
              />
            </div>
            <div className="space-y-2">
              <Label>Canal asignado</Label>
              <Select value={editAssignedChannel || '__none__'} onValueChange={(v) => setEditAssignedChannel(v === '__none__' ? '' : v)}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Seleccionar canal..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="__none__">— Sin asignar —</SelectItem>
                  <SelectItem value="Meta Ads">Meta Ads</SelectItem>
                  <SelectItem value="Google Ads">Google Ads</SelectItem>
                  <SelectItem value="Orgánico">Orgánico</SelectItem>
                  <SelectItem value="Todos">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Estado del miembro</Label>
              <Select value={editMemberStatus} onValueChange={(v) => setEditMemberStatus(v as 'activo' | 'inactivo' | 'prueba')}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="activo">Activo</SelectItem>
                  <SelectItem value="inactivo">Inactivo</SelectItem>
                  <SelectItem value="prueba">Prueba</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Código de afiliado</Label>
              <Input
                value={editAffiliateCode}
                onChange={(e) => setEditAffiliateCode(e.target.value)}
                className="bg-muted border-border"
                placeholder="ej. juan10"
              />
              <p className="text-xs text-muted-foreground">Se usa para atribuir ventas al afiliado por utm_content.</p>
            </div>
            <div className="space-y-2">
              <Label>Código de tracking (enlaces)</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={editTrackingCode}
                  onChange={(e) => setEditTrackingCode(e.target.value)}
                  className="bg-muted border-border font-mono"
                  placeholder="ej. s7k2m9qp"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleRegenerateTrackingCode}
                  disabled={regeneratingCode}
                  title="Generar / regenerar código"
                >
                  {regeneratingCode ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Código privado y opaco (no revela el nombre). Se usa en los enlaces de la sección Enlaces
                (utm_term para setter/cold caller, utm_content para afiliado).
              </p>
            </div>
            <div className="space-y-2">
              <Label>Páginas que puede ver (vacío = según su rol)</Label>
              <PageAccessSelector value={editPageOverrides} onChange={setEditPageOverrides} />
            </div>
            <div className="space-y-2">
              <Label>Estado</Label>
              <button
                type="button"
                onClick={() => setEditIsActive(!editIsActive)}
                className={`w-full h-10 rounded-md border text-sm transition-colors ${
                  editIsActive
                    ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400'
                    : 'bg-muted border-border text-muted-foreground'
                }`}
              >
                {editIsActive ? 'Activo' : 'Inactivo'}
              </button>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setEditDialog(false)} disabled={submitting}>Cancelar</Button>
              <Button onClick={handleEditUser} disabled={submitting}>
                {submitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar Cambios'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
