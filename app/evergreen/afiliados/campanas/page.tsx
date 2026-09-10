"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Megaphone, Plus, Pencil, Trash2, Loader2, Users, Search, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS, type AppRole } from '@/lib/auth/permissions'
import { generateTrackingCode } from '@/lib/tracking'
import type { AffiliateCampaign, AffiliateCampaignType } from '@/lib/types/database'

type Affiliate = { id: string; full_name: string; affiliate_code: string | null }

const TYPE_OPTIONS: { value: AffiliateCampaignType; label: string }[] = [
  { value: 'evento', label: 'Evento' },
  { value: 'lanzamiento', label: 'Lanzamiento' },
  { value: 'vsl', label: 'VSL' },
  { value: 'otro', label: 'Otro' },
]
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.value, t.label]))

export default function CampanasAfiliadosPage() {
  const [role, setRole] = useState<AppRole | ''>('')
  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<AffiliateCampaign[]>([])
  const [affiliates, setAffiliates] = useState<Affiliate[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Crear / editar campaña
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<AffiliateCampaignType>('evento')
  const [baseUrl, setBaseUrl] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Asignación de afiliados
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignCampaign, setAssignCampaign] = useState<AffiliateCampaign | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [savingAssign, setSavingAssign] = useState(false)

  const canManage = role ? PERMISSIONS.canManageAffiliateCampaigns(role) : false

  const fetchAll = useCallback(async () => {
    const sb = createClient()
    const { data: { user } } = await sb.auth.getUser()
    if (!user) { setLoading(false); return }
    setCurrentUserId(user.id)

    const { data: me } = await sb.from('users').select('roles(key)').eq('id', user.id).single()
    setRole(((me as { roles?: { key?: string } } | null)?.roles?.key ?? '') as AppRole)

    const [campRes, affRes, memRes] = await Promise.all([
      sb.from('affiliate_campaigns').select('*').order('created_at', { ascending: false }),
      sb.from('users').select('id, full_name, affiliate_code, roles!inner(key)').eq('roles.key', 'affiliate'),
      sb.from('affiliate_campaign_members').select('campaign_id'),
    ])

    setCampaigns((campRes.data as AffiliateCampaign[]) ?? [])
    setAffiliates((affRes.data as Affiliate[]) ?? [])

    const c: Record<string, number> = {}
    for (const m of ((memRes.data as { campaign_id: string }[]) ?? [])) {
      c[m.campaign_id] = (c[m.campaign_id] ?? 0) + 1
    }
    setCounts(c)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ---- CRUD campaña ----
  const resetForm = () => {
    setEditingId(null); setName(''); setType('evento'); setBaseUrl(''); setIsActive(true)
  }
  const openCreate = () => { resetForm(); setDialogOpen(true) }
  const openEdit = (c: AffiliateCampaign) => {
    setEditingId(c.id); setName(c.name); setType(c.type); setBaseUrl(c.base_url); setIsActive(c.is_active)
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!name.trim() || !baseUrl.trim()) { toast.error('Completa nombre y URL'); return }
    let url = baseUrl.trim()
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`

    setSubmitting(true)
    const sb = createClient()
    const payload = { name: name.trim(), type, base_url: url, is_active: isActive }
    // Al crear generamos el slug del enlace público de registro/alta a la campaña.
    // Al editar lo dejamos intacto para no romper enlaces ya compartidos.
    const { error } = editingId
      ? await sb.from('affiliate_campaigns').update(payload).eq('id', editingId)
      : await sb.from('affiliate_campaigns').insert({
          ...payload,
          created_by: currentUserId,
          registration_slug: generateTrackingCode(10),
        })
    setSubmitting(false)
    if (error) { toast.error('Error al guardar', { description: error.message }); return }
    toast.success(editingId ? 'Campaña actualizada' : 'Campaña creada')
    setDialogOpen(false); resetForm(); fetchAll()
  }

  const handleDelete = async (c: AffiliateCampaign) => {
    if (!confirm(`¿Eliminar la campaña "${c.name}"? Se quitarán todas sus asignaciones.`)) return
    const sb = createClient()
    const { error } = await sb.from('affiliate_campaigns').delete().eq('id', c.id)
    if (error) { toast.error('Error al eliminar', { description: error.message }); return }
    toast.success('Campaña eliminada'); fetchAll()
  }

  // Enlace público de registro/alta para la campaña. Quien lo abra:
  //  · si ya es usuario → se le asigna la campaña; · si no → se crea su cuenta de afiliado y se asigna.
  const registrationLink = (c: AffiliateCampaign) =>
    c.registration_slug ? `${window.location.origin}/evergreen/afiliados/registro?c=${c.registration_slug}` : null

  const copyLink = async (c: AffiliateCampaign) => {
    const link = registrationLink(c)
    if (!link) { toast.error('Esta campaña aún no tiene enlace. Vuelve a guardarla.'); return }
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Enlace de registro copiado')
    } catch {
      toast.error('No se pudo copiar', { description: link })
    }
  }

  const toggleActive = async (c: AffiliateCampaign) => {
    const sb = createClient()
    const { error } = await sb.from('affiliate_campaigns').update({ is_active: !c.is_active }).eq('id', c.id)
    if (error) { toast.error('Error al actualizar'); return }
    fetchAll()
  }

  // ---- Asignación masiva ----
  const openAssign = async (c: AffiliateCampaign) => {
    setAssignCampaign(c); setSearch(''); setAssignOpen(true)
    const sb = createClient()
    const { data } = await sb.from('affiliate_campaign_members').select('affiliate_id').eq('campaign_id', c.id)
    setSelected(new Set(((data as { affiliate_id: string }[]) ?? []).map((m) => m.affiliate_id)))
  }

  const filteredAffiliates = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return affiliates
    return affiliates.filter(
      (a) => a.full_name.toLowerCase().includes(q) || (a.affiliate_code ?? '').toLowerCase().includes(q)
    )
  }, [affiliates, search])

  const allFilteredSelected = filteredAffiliates.length > 0 && filteredAffiliates.every((a) => selected.has(a.id))
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) filteredAffiliates.forEach((a) => next.delete(a.id))
      else filteredAffiliates.forEach((a) => next.add(a.id))
      return next
    })
  }
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const saveAssign = async () => {
    if (!assignCampaign) return
    setSavingAssign(true)
    const sb = createClient()
    const { data: currentRows } = await sb
      .from('affiliate_campaign_members')
      .select('affiliate_id')
      .eq('campaign_id', assignCampaign.id)
    const current = new Set(((currentRows as { affiliate_id: string }[]) ?? []).map((m) => m.affiliate_id))

    const toAdd = Array.from(selected).filter((id) => !current.has(id))
    const toRemove = Array.from(current).filter((id) => !selected.has(id))

    if (toAdd.length) {
      const { error } = await sb.from('affiliate_campaign_members').insert(
        toAdd.map((affiliate_id) => ({
          campaign_id: assignCampaign.id,
          affiliate_id,
          created_by: currentUserId,
        }))
      )
      if (error) { setSavingAssign(false); toast.error('Error al asignar', { description: error.message }); return }
    }
    if (toRemove.length) {
      const { error } = await sb
        .from('affiliate_campaign_members')
        .delete()
        .eq('campaign_id', assignCampaign.id)
        .in('affiliate_id', toRemove)
      if (error) { setSavingAssign(false); toast.error('Error al quitar afiliados', { description: error.message }); return }
    }

    setSavingAssign(false)
    setAssignOpen(false)
    toast.success(`Asignación guardada (${selected.size} afiliados)`)
    fetchAll()
  }

  if (loading) return <div className="h-48 bg-card rounded-lg animate-pulse" />

  if (!canManage) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
        No tienes permisos para gestionar campañas de afiliados.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
            <Megaphone className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Campañas de afiliados</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Enlaces por evento, lanzamiento o VSL. Comparte el enlace de registro para dar de alta y asignar afiliados en masa, o asígnalos a mano.
            </p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" /> Nueva campaña
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-border rounded-lg">
          <Megaphone className="w-10 h-10 text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm mb-4">Aún no hay campañas de afiliados</p>
          <Button onClick={openCreate} size="sm"><Plus className="w-4 h-4 mr-2" /> Crear la primera</Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
          {campaigns.map((c) => (
            <div key={c.id} className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-foreground font-medium">{c.name}</p>
                  <Badge variant="outline" className="text-xs">{TYPE_LABEL[c.type] ?? c.type}</Badge>
                  <Badge
                    variant={c.is_active ? 'success' : 'secondary'}
                    className="cursor-pointer"
                    onClick={() => toggleActive(c)}
                  >
                    {c.is_active ? 'Activa' : 'Inactiva'}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs font-mono mt-1 truncate">{c.base_url}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="outline" size="sm" className="h-8" onClick={() => copyLink(c)} title="Copiar enlace de registro a la campaña">
                  <Link2 className="w-3.5 h-3.5 mr-1.5" />
                  Enlace
                </Button>
                <Button variant="outline" size="sm" className="h-8" onClick={() => openAssign(c)}>
                  <Users className="w-3.5 h-3.5 mr-1.5" />
                  {counts[c.id] ?? 0}
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-foreground" onClick={() => openEdit(c)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-red-400" onClick={() => handleDelete(c)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dialog crear/editar */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm() }}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar campaña' : 'Nueva campaña'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-muted border-border" placeholder="Ej: Masterclass Octubre" />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={type} onValueChange={(v) => setType(v as AffiliateCampaignType)}>
                <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>URL base *</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="bg-muted border-border" placeholder="https://iawinners.com/evento" />
              <p className="text-xs text-muted-foreground">Se añade automáticamente utm_content con el código de cada afiliado.</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <Checkbox id="camp-active" checked={isActive} onCheckedChange={(c) => setIsActive(c === true)} />
              <Label htmlFor="camp-active" className="cursor-pointer">Campaña activa</Label>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Cancelar</Button>
              <Button onClick={handleSubmit} disabled={submitting || !name || !baseUrl}>
                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {editingId ? 'Guardar' : 'Crear'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog asignación masiva */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="bg-card border-border text-foreground max-w-md max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Afiliados — {assignCampaign?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2 flex-1 min-h-0 flex flex-col">
            <div className="relative">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar afiliado o código..."
                className="bg-muted border-border pl-9"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <button type="button" onClick={toggleAll} className="hover:text-foreground flex items-center gap-2">
                <Checkbox checked={allFilteredSelected} />
                {allFilteredSelected ? 'Quitar todos' : 'Seleccionar todos'}
                {search && ' (filtrados)'}
              </button>
              <span>{selected.size} seleccionados</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {affiliates.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No hay afiliados todavía.</div>
              ) : filteredAffiliates.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Sin resultados.</div>
              ) : (
                filteredAffiliates.map((a) => (
                  <label key={a.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40">
                    <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggleOne(a.id)} />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{a.full_name}</p>
                      {a.affiliate_code && <p className="text-[11px] text-muted-foreground font-mono">{a.affiliate_code}</p>}
                    </div>
                  </label>
                ))
              )}
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={savingAssign}>Cancelar</Button>
              <Button onClick={saveAssign} disabled={savingAssign}>
                {savingAssign ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Guardar asignación
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
