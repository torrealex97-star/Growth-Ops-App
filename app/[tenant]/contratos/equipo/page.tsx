'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileSignature, Plus, Loader2, Copy, ExternalLink, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CommissionRule, ContractTemplate, User, Role, Contract } from '@/lib/types/database'
import { buildDefaultTerms, type ContractTerms } from '@/lib/contracts/terms'
import { ROLE_LABELS, type AppRole } from '@/lib/auth/permissions'
import { ContractTermsEditor } from '@/components/contracts/ContractTermsEditor'
import { useTenant, useTenantId } from '@/lib/tenant-context'

type UserWithRole = User & { roles: Role }
type TeamContract = Contract & { users: { full_name: string; roles: { name: string } | null } | null }

const STATUS_STYLES: Record<string, string> = {
  pendiente: 'bg-zinc-500/20 text-muted-foreground border-border/30',
  enviado: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  firmado: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
}

export default function ContratosEquipoPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [users, setUsers] = useState<UserWithRole[]>([])
  const [rules, setRules] = useState<CommissionRule[]>([])
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [contracts, setContracts] = useState<TeamContract[]>([])
  const [loading, setLoading] = useState(true)

  const [openingPdfId, setOpeningPdfId] = useState<string | null>(null)

  const [dialog, setDialog] = useState(false)
  const [userId, setUserId] = useState('')
  const [roleKey, setRoleKey] = useState<AppRole | ''>('')
  const [templateId, setTemplateId] = useState('')
  const [title, setTitle] = useState('')
  const [terms, setTerms] = useState<ContractTerms | null>(null)
  const [personalEmail, setPersonalEmail] = useState('')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<{
    name: string
    url: string
    emailed: boolean
    emailError: string | null
    email: string | null
    personalEmail: string | null
  } | null>(null)

  const load = async () => {
    const sb = createClient()
    const [u, r, t, c] = await Promise.all([
      sb.from('users').select('*, roles(*)').eq('is_active', true).order('full_name'),
      sb.from('commission_rules').select('*').eq('tenant_id', tenantId),
      sb
        .from('contract_templates')
        .select('*')
        .eq('is_active', true)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
      sb
        .from('contracts')
        .select('*, users:user_id(full_name, roles(name))')
        .eq('kind', 'equipo')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false }),
    ])
    setUsers((u.data ?? []) as UserWithRole[])
    setRules((r.data ?? []) as CommissionRule[])
    setTemplates((t.data ?? []) as ContractTemplate[])
    setContracts((c.data ?? []) as TeamContract[])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const selectedUser = useMemo(() => users.find((u) => u.id === userId), [users, userId])

  // Recalcula condiciones + título + plantilla para un miembro y un rol dados.
  const recompute = (u: UserWithRole, rk: AppRole) => {
    const roleLabel = ROLE_LABELS[rk] ?? rk
    setTerms(buildDefaultTerms(u, rk, roleLabel, rules))
    setTitle(`Contrato ${roleLabel} — ${u.full_name}`)
    const match = templates.find((t) => t.role_key === rk) ?? templates[0]
    setTemplateId(match?.id ?? '')
  }

  // Al elegir miembro: rol por defecto = su rol real; carga sus condiciones.
  const onSelectUser = (id: string) => {
    setUserId(id)
    const u = users.find((x) => x.id === id)
    if (!u) {
      setTerms(null)
      setPersonalEmail('')
      return
    }
    setPersonalEmail(u.personal_email ?? '')
    const rk = (u.roles?.key as AppRole) ?? 'closer'
    setRoleKey(rk)
    recompute(u, rk)
  }

  // Al cambiar el rol del contrato: recalcula condiciones según ese rol.
  const onSelectRole = (rk: AppRole) => {
    setRoleKey(rk)
    const u = users.find((x) => x.id === userId)
    if (u) recompute(u, rk)
  }

  const generate = async () => {
    if (!userId || !terms) {
      toast.error('Selecciona un miembro')
      return
    }
    setGenerating(true)
    const res = await fetch(`/api/${tenant}/evergreen/contracts/team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        templateId: templateId || null,
        title,
        terms,
        roleKey,
        roleLabel: roleKey ? ROLE_LABELS[roleKey] : null,
        personalEmail: personalEmail.trim() || null,
      }),
    })
    const d = await res.json()
    setGenerating(false)
    if (!res.ok) {
      toast.error('No se pudo generar', { description: d.error })
      return
    }
    setDialog(false)
    setResult({
      name: selectedUser?.full_name ?? 'el colaborador',
      url: d.signUrl,
      emailed: !!d.emailed,
      emailError: d.emailError ?? null,
      email: d.memberEmail ?? null,
      personalEmail: d.personalEmail ?? null,
    })
    setUserId('')
    setRoleKey('')
    setTerms(null)
    setTitle('')
    setTemplateId('')
    setPersonalEmail('')
    load()
  }

  const copyLink = (url: string) => {
    navigator.clipboard?.writeText(url)
    toast.success('Enlace copiado')
  }

  const del = async (c: TeamContract) => {
    if (!confirm('¿Eliminar este contrato?')) return
    const sb = createClient()
    const { error } = await sb.from('contracts').delete().eq('id', c.id).eq('tenant_id', tenantId)
    if (error) {
      toast.error('No se pudo eliminar', { description: error.message })
      return
    }
    load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contratos de equipo</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Genera y envía contratos a firmar con las condiciones del miembro (fijo + comisiones).
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => (window.location.href = `/${tenant}/contratos/plantillas`)}>
            Plantillas
          </Button>
          <Button onClick={() => setDialog(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo contrato
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="h-48 bg-card rounded-lg animate-pulse" />
      ) : contracts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileSignature className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Sin contratos de equipo</h3>
          <p className="text-muted-foreground text-sm">Genera el primero con el botón &quot;Nuevo contrato&quot;.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
          {contracts.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-4 p-4 bg-card/40">
              <div className="min-w-0">
                <p className="text-foreground font-medium truncate">{c.users?.full_name ?? c.title}</p>
                <p className="text-xs text-muted-foreground truncate">{c.title}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className={`border text-xs ${STATUS_STYLES[c.status]}`}>{c.status}</Badge>
                {c.status !== 'firmado' && c.signing_token && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => copyLink(`${window.location.origin}/firmar/${c.signing_token}`)}
                  >
                    <Copy className="w-3.5 h-3.5 mr-1" /> Enlace
                  </Button>
                )}
                {c.signed_pdf_url && (
                  <button
                    type="button"
                    disabled={openingPdfId === c.id}
                    onClick={async () => {
                      setOpeningPdfId(c.id)
                      try {
                        const res = await fetch(`/api/${tenant}/evergreen/contracts/pdf-url?contractId=${c.id}`)
                        const d = await res.json().catch(() => ({}))
                        if (res.ok && d.url) window.open(d.url, '_blank', 'noopener,noreferrer')
                        else toast.error('No se pudo abrir el PDF', { description: d?.error })
                      } catch {
                        toast.error('No se pudo abrir el PDF')
                      } finally {
                        setOpeningPdfId(null)
                      }
                    }}
                    className="text-sm text-emerald-400 hover:underline flex items-center gap-1 disabled:opacity-60"
                  >
                    {openingPdfId === c.id ? 'Abriendo…' : 'PDF'} <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-red-400"
                  onClick={() => del(c)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog generar */}
      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo contrato de equipo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Miembro del equipo</Label>
              <Select value={userId} onValueChange={onSelectUser}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Seleccionar miembro…" />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name} · {u.roles?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {userId && (
              <>
                <ContractTermsEditor
                  roleKey={roleKey}
                  onRoleChange={onSelectRole}
                  terms={terms}
                  onTermsChange={setTerms}
                  templateId={templateId}
                  onTemplateChange={setTemplateId}
                  templates={templates}
                  title={title}
                  onTitleChange={setTitle}
                />

                <div className="space-y-2">
                  <Label>Correo personal (opcional)</Label>
                  <Input
                    type="email"
                    value={personalEmail}
                    onChange={(e) => setPersonalEmail(e.target.value)}
                    className="bg-muted border-border"
                    placeholder="correo.personal@gmail.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Se añade al contrato como variable{' '}
                    <code className="text-muted-foreground">{'{{email_personal}}'}</code> y recibe una copia. El
                    contrato se envía a{' '}
                    <span className="text-foreground">{selectedUser?.email || 'su correo de empresa'}</span> y, si lo
                    indicas, con copia al personal.
                  </p>
                </div>
              </>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDialog(false)} disabled={generating}>
                Cancelar
              </Button>
              <Button onClick={generate} disabled={generating || !userId || !terms}>
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generando…
                  </>
                ) : (
                  'Generar y obtener enlace'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Resultado: enlace de firma */}
      <Dialog open={!!result} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>Contrato listo para firmar</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {result?.emailed ? (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 text-sm text-emerald-300">
                ✓ Email enviado automáticamente a{' '}
                <span className="text-foreground">{result.email ?? result.personalEmail}</span>
                {result.personalEmail && result.email && (
                  <>
                    {' '}
                    con copia a <span className="text-foreground">{result.personalEmail}</span>
                  </>
                )}
                . También puedes compartir el enlace manualmente:
              </div>
            ) : (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
                {result?.emailError ? (
                  <>No se pudo enviar el email automático ({result.emailError}). Comparte el enlace manualmente:</>
                ) : (
                  <>
                    Envío por email no configurado. Comparte este enlace con{' '}
                    <span className="text-foreground">{result?.name}</span> (WhatsApp, email…):
                  </>
                )}
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Al firmarlo, el PDF se guarda automáticamente aquí y se puede descargar.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted border border-border rounded-lg px-3 py-2.5 text-xs text-sky-400 font-mono break-all select-all">
                {result?.url}
              </code>
              <Button variant="outline" size="icon" onClick={() => result && copyLink(result.url)} title="Copiar">
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setResult(null)}>Hecho</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
