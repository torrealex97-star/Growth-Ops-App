"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Link2, Copy, Check, Plus, Pencil, Trash2, Loader2, AlertTriangle, ExternalLink, FolderOpen, FolderPlus, Database, X } from 'lucide-react'
import { toast } from 'sonner'
import { PERMISSIONS, ROLE_LABELS, type AppRole } from '@/lib/auth/permissions'
import type { LinkTemplate, ResourceLink, ResourceLinkDivision } from '@/lib/types/database'
import { useTenant, useTenantId } from '@/lib/tenant-context'

type CurrentUser = {
  id: string
  role: AppRole
  tracking_code: string | null
  affiliate_code: string | null
}

// Roles a los que aplica el sistema de enlaces con UTM
const LINK_ROLES: AppRole[] = ['setter', 'closer', 'cold_caller', 'affiliate']

// Roles que pueden ver enlaces (para acotar la visibilidad de los recursos varios)
const RESOURCE_ROLES: AppRole[] = ['admin', 'director', 'manager', 'setter', 'closer', 'cold_caller', 'affiliate']

const NO_DIVISION = 'none' // valor del Select para "Sin división"

function buildTrackedUrl(baseUrl: string, role: AppRole, code: string): string {
  const param = role === 'affiliate' ? 'utm_content' : 'utm_term'
  try {
    const url = new URL(baseUrl)
    url.searchParams.set(param, code)
    return url.toString()
  } catch {
    // base_url puede no ser una URL absoluta válida; hacemos append manual
    const separator = baseUrl.includes('?') ? '&' : '?'
    return `${baseUrl}${separator}${param}=${encodeURIComponent(code)}`
  }
}

export default function EnlacesPage() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [templates, setTemplates] = useState<LinkTemplate[]>([])
  const [allTemplates, setAllTemplates] = useState<LinkTemplate[]>([])
  // Afiliados: enlaces por campaña asignada (no plantillas de rol)
  const [affiliateCampaigns, setAffiliateCampaigns] = useState<{ id: string; name: string; base_url: string }[]>([])
  // Enlaces varios (recursos) + divisiones/carpetas
  const [resources, setResources] = useState<ResourceLink[]>([])
  const [divisions, setDivisions] = useState<ResourceLinkDivision[]>([])
  const [resourceTableMissing, setResourceTableMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Admin management (plantillas UTM)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [appliesTo, setAppliesTo] = useState<AppRole[]>([])
  const [isActive, setIsActive] = useState(true)

  // Admin management (recursos varios)
  const [resDialogOpen, setResDialogOpen] = useState(false)
  const [resSubmitting, setResSubmitting] = useState(false)
  const [resEditingId, setResEditingId] = useState<string | null>(null)
  const [resDivisionId, setResDivisionId] = useState<string>(NO_DIVISION)
  const [resName, setResName] = useState('')
  const [resUrl, setResUrl] = useState('')
  const [resDescription, setResDescription] = useState('')
  const [resAppliesTo, setResAppliesTo] = useState<AppRole[]>([])
  const [resActive, setResActive] = useState(true)
  const [migrating, setMigrating] = useState(false)

  // Divisiones (crear / renombrar)
  const [newDivisionName, setNewDivisionName] = useState('')
  const [savingDivision, setSavingDivision] = useState(false)
  const [editingDivisionId, setEditingDivisionId] = useState<string | null>(null)
  const [editingDivisionName, setEditingDivisionName] = useState('')

  const canManage = user ? PERMISSIONS.canManageLinkTemplates(user.role) : false
  // Solo los roles que generan enlaces UTM propios ven el bloque de enlaces personales con tracking.
  const isTrackedRole = user ? LINK_ROLES.includes(user.role) : false

  const fetchAll = useCallback(async () => {
    const supabase = createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      setLoading(false)
      return
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, tracking_code, affiliate_code, roles(key)')
      .eq('id', authUser.id)
      .single()

    if (profileError || !profile) {
      toast.error('Error al cargar el usuario')
      setLoading(false)
      return
    }

    const role = (profile as unknown as { roles: { key: string } }).roles?.key as AppRole
    const current: CurrentUser = {
      id: profile.id,
      role,
      tracking_code: (profile as unknown as { tracking_code: string | null }).tracking_code,
      affiliate_code: (profile as unknown as { affiliate_code: string | null }).affiliate_code,
    }
    setUser(current)

    const isManager = PERMISSIONS.canManageLinkTemplates(role)

    if (isManager) {
      const { data, error } = await supabase
        .from('link_templates')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (!error) setAllTemplates((data as LinkTemplate[]) ?? [])
    }

    // Divisiones (carpetas) + enlaces varios. RLS filtra por applies_to; admin/director ven todo.
    // Solo tratamos como "tabla ausente" el error REAL: 42P01 (undefined_table) o PGRST205 (schema cache).
    // El banner de migración debe salir si falta CUALQUIERA de las dos tablas → acumulamos en una var local
    // y fijamos el estado una sola vez (evita que el éxito de una consulta borre el fallo de la otra).
    {
      const isMissing = (e: { code?: string } | null) => !!e && (e.code === '42P01' || e.code === 'PGRST205')
      let tableMissing = false

      const { data: divData, error: divErr } = await supabase
        .from('resource_link_divisions')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (divErr) {
        if (isMissing(divErr)) tableMissing = true
        else toast.error('Error al cargar las divisiones', { description: divErr.message })
      } else {
        setDivisions((divData as ResourceLinkDivision[]) ?? [])
      }

      let query = supabase.from('resource_links').select('*')
      if (!isManager) query = query.eq('is_active', true)
      const { data: resData, error: resErr } = await query
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (resErr) {
        if (isMissing(resErr)) tableMissing = true
        else toast.error('Error al cargar los recursos', { description: resErr.message })
      } else {
        setResources((resData as ResourceLink[]) ?? [])
      }

      setResourceTableMissing(tableMissing)
    }

    // Afiliados: sus enlaces salen de las campañas de afiliados asignadas, no de las plantillas de rol.
    if (role === 'affiliate') {
      const { data: memberRows, error: campErr } = await supabase
        .from('affiliate_campaign_members')
        .select('affiliate_campaigns(id, name, base_url, is_active)')
        .eq('affiliate_id', current.id)
        .eq('tenant_id', tenantId)
      if (campErr) {
        toast.error('Error al cargar tus campañas')
      } else {
        const camps = ((memberRows as unknown as { affiliate_campaigns: { id: string; name: string; base_url: string; is_active: boolean } | null }[]) ?? [])
          .map((r) => r.affiliate_campaigns)
          .filter((c): c is { id: string; name: string; base_url: string; is_active: boolean } => !!c && c.is_active)
          .sort((a, b) => a.name.localeCompare(b.name))
        setAffiliateCampaigns(camps.map(({ id, name, base_url }) => ({ id, name, base_url })))
      }
      setLoading(false)
      return
    }

    const { data: activeTemplates, error: templatesError } = await supabase
      .from('link_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .contains('applies_to', [role])
      .order('name')

    if (templatesError) {
      toast.error('Error al cargar las plantillas de enlaces')
    } else {
      setTemplates((activeTemplates as LinkTemplate[]) ?? [])
    }

    setLoading(false)
  }, [tenantId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const userCode = useMemo(() => {
    if (!user) return null
    if (user.role === 'affiliate') return user.tracking_code || user.affiliate_code || null
    return user.tracking_code || null
  }, [user])

  const generatedLinks = useMemo(() => {
    if (!user || !userCode) return []
    if (user.role === 'affiliate') {
      return affiliateCampaigns.map((c) => ({
        id: c.id,
        name: c.name,
        url: buildTrackedUrl(c.base_url, user.role, userCode),
      }))
    }
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      url: buildTrackedUrl(t.base_url, user.role, userCode),
    }))
  }, [templates, affiliateCampaigns, user, userCode])

  const divisionName = useCallback(
    (id: string | null) => divisions.find((d) => d.id === id)?.name ?? 'Sin división',
    [divisions]
  )

  // Recursos ACTIVOS agrupados por división (para la vista de todos)
  const activeGrouped = useMemo(() => {
    const active = resources.filter((r) => r.is_active)
    const byDiv = new Map<string | null, ResourceLink[]>()
    for (const r of active) {
      const key = r.division_id ?? null
      if (!byDiv.has(key)) byDiv.set(key, [])
      byDiv.get(key)!.push(r)
    }
    const groups: { id: string | null; name: string; items: ResourceLink[] }[] = []
    for (const d of divisions) {
      const items = byDiv.get(d.id)
      if (items && items.length) groups.push({ id: d.id, name: d.name, items })
    }
    const orphan = byDiv.get(null)
    if (orphan && orphan.length) groups.push({ id: null, name: 'Sin división', items: orphan })
    return groups
  }, [resources, divisions])

  // Vista admin: TODAS las divisiones (aunque estén vacías) + huérfanos, con inactivos incluidos
  const adminGrouped = useMemo(() => {
    const byDiv = new Map<string | null, ResourceLink[]>()
    for (const r of resources) {
      const key = r.division_id ?? null
      if (!byDiv.has(key)) byDiv.set(key, [])
      byDiv.get(key)!.push(r)
    }
    const groups: { id: string | null; name: string; items: ResourceLink[] }[] = divisions.map((d) => ({
      id: d.id,
      name: d.name,
      items: byDiv.get(d.id) ?? [],
    }))
    const orphan = byDiv.get(null)
    if (orphan && orphan.length) groups.push({ id: null, name: 'Sin división', items: orphan })
    return groups
  }, [resources, divisions])

  const handleCopy = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      toast.success('Enlace copiado')
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000)
    } catch {
      toast.error('No se pudo copiar el enlace')
    }
  }

  // ---- Admin CRUD: plantillas UTM ----
  const resetForm = () => {
    setName('')
    setBaseUrl('')
    setAppliesTo([])
    setIsActive(true)
    setEditingId(null)
  }

  const openCreate = () => {
    resetForm()
    setDialogOpen(true)
  }

  const openEdit = (template: LinkTemplate) => {
    setEditingId(template.id)
    setName(template.name)
    setBaseUrl(template.base_url)
    setAppliesTo((template.applies_to ?? []) as AppRole[])
    setIsActive(template.is_active)
    setDialogOpen(true)
  }

  const toggleAppliesTo = (role: AppRole) => {
    setAppliesTo((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  const handleSubmit = async () => {
    if (!name || !baseUrl || appliesTo.length === 0) {
      toast.error('Completa nombre, URL base y al menos un rol')
      return
    }

    let normalizedUrl = baseUrl.trim()
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`
    }

    setSubmitting(true)
    const supabase = createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

    const payload = {
      name,
      base_url: normalizedUrl,
      applies_to: appliesTo,
      is_active: isActive,
      created_by: authUser?.id ?? null,
    }

    const { error } = editingId
      ? await supabase.from('link_templates').update(payload).eq('id', editingId).eq('tenant_id', tenantId)
      : await supabase.from('link_templates').insert({ ...payload, tenant_id: tenantId })

    setSubmitting(false)
    if (error) {
      toast.error(editingId ? 'Error al actualizar la plantilla' : 'Error al crear la plantilla', {
        description: error.message,
      })
      return
    }

    toast.success(editingId ? 'Plantilla actualizada' : 'Plantilla creada')
    setDialogOpen(false)
    resetForm()
    fetchAll()
  }

  const handleDelete = async (template: LinkTemplate) => {
    if (!confirm(`¿Eliminar la plantilla "${template.name}"?`)) return
    const supabase = createClient()
    const { error } = await supabase.from('link_templates').delete().eq('id', template.id).eq('tenant_id', tenantId)
    if (error) {
      toast.error('Error al eliminar la plantilla', { description: error.message })
      return
    }
    toast.success('Plantilla eliminada')
    fetchAll()
  }

  const toggleActive = async (template: LinkTemplate) => {
    const supabase = createClient()
    const { error } = await supabase
      .from('link_templates')
      .update({ is_active: !template.is_active })
      .eq('id', template.id)
      .eq('tenant_id', tenantId)
    if (error) {
      toast.error('Error al actualizar la plantilla')
      return
    }
    fetchAll()
  }

  // ---- Admin CRUD: divisiones ----
  const createDivision = async () => {
    const nm = newDivisionName.trim()
    if (!nm) return
    setSavingDivision(true)
    const supabase = createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
    const { error } = await supabase.from('resource_link_divisions').insert({
      name: nm,
      sort_order: divisions.length,
      created_by: authUser?.id ?? null,
    })
    setSavingDivision(false)
    if (error) {
      toast.error('Error al crear la división', { description: error.message })
      return
    }
    toast.success('División creada')
    setNewDivisionName('')
    fetchAll()
  }

  const saveDivisionName = async (id: string) => {
    const nm = editingDivisionName.trim()
    if (!nm) return
    const supabase = createClient()
    const { error } = await supabase.from('resource_link_divisions').update({ name: nm }).eq('id', id)
    if (error) {
      toast.error('Error al renombrar', { description: error.message })
      return
    }
    setEditingDivisionId(null)
    setEditingDivisionName('')
    fetchAll()
  }

  const deleteDivision = async (d: ResourceLinkDivision) => {
    const count = resources.filter((r) => r.division_id === d.id).length
    const msg = count > 0
      ? `¿Eliminar la división "${d.name}"? Sus ${count} enlace(s) quedarán como "Sin división" (no se borran).`
      : `¿Eliminar la división "${d.name}"?`
    if (!confirm(msg)) return
    const supabase = createClient()
    const { error } = await supabase.from('resource_link_divisions').delete().eq('id', d.id)
    if (error) {
      toast.error('Error al eliminar la división', { description: error.message })
      return
    }
    toast.success('División eliminada')
    fetchAll()
  }

  // ---- Admin CRUD: recursos varios ----
  const resetResForm = () => {
    setResDivisionId(NO_DIVISION)
    setResName('')
    setResUrl('')
    setResDescription('')
    setResAppliesTo([])
    setResActive(true)
    setResEditingId(null)
  }

  const openResCreate = (presetDivisionId?: string | null) => {
    resetResForm()
    if (presetDivisionId) setResDivisionId(presetDivisionId)
    setResDialogOpen(true)
  }

  const openResEdit = (r: ResourceLink) => {
    setResEditingId(r.id)
    setResDivisionId(r.division_id ?? NO_DIVISION)
    setResName(r.name)
    setResUrl(r.url)
    setResDescription(r.description ?? '')
    setResAppliesTo((r.applies_to ?? []) as AppRole[])
    setResActive(r.is_active)
    setResDialogOpen(true)
  }

  const toggleResAppliesTo = (role: AppRole) => {
    setResAppliesTo((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]))
  }

  const handleResSubmit = async () => {
    if (!resName || !resUrl) {
      toast.error('Completa nombre y URL')
      return
    }
    let normalizedUrl = resUrl.trim()
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`
    }

    const divId = resDivisionId === NO_DIVISION ? null : resDivisionId

    setResSubmitting(true)
    const supabase = createClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()

    const payload = {
      division_id: divId,
      category: divId ? divisionName(divId) : 'General', // respaldo/legacy
      name: resName.trim(),
      url: normalizedUrl,
      description: resDescription.trim() || null,
      applies_to: resAppliesTo,
      is_active: resActive,
      created_by: authUser?.id ?? null,
    }

    const { error } = resEditingId
      ? await supabase.from('resource_links').update(payload).eq('id', resEditingId)
      : await supabase.from('resource_links').insert(payload)

    setResSubmitting(false)
    if (error) {
      toast.error(resEditingId ? 'Error al actualizar el enlace' : 'Error al crear el enlace', {
        description: error.message,
      })
      return
    }
    toast.success(resEditingId ? 'Enlace actualizado' : 'Enlace creado')
    setResDialogOpen(false)
    resetResForm()
    fetchAll()
  }

  const handleResDelete = async (r: ResourceLink) => {
    if (!confirm(`¿Eliminar el enlace "${r.name}"?`)) return
    const supabase = createClient()
    const { error } = await supabase.from('resource_links').delete().eq('id', r.id)
    if (error) {
      toast.error('Error al eliminar el enlace', { description: error.message })
      return
    }
    toast.success('Enlace eliminado')
    fetchAll()
  }

  const toggleResActive = async (r: ResourceLink) => {
    const supabase = createClient()
    const { error } = await supabase.from('resource_links').update({ is_active: !r.is_active }).eq('id', r.id)
    if (error) {
      toast.error('Error al actualizar el enlace')
      return
    }
    fetchAll()
  }

  const runResourceMigration = async () => {
    setMigrating(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/admin/migrate-resource-links`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        toast.error('Error en la migración', { description: JSON.stringify(data.report ?? data.error) })
      } else {
        toast.success('Migración aplicada', { description: 'Tablas de recursos creadas.' })
        setResourceTableMissing(false)
        fetchAll()
      }
    } catch (e) {
      toast.error('Error al ejecutar la migración', { description: String(e) })
    }
    setMigrating(false)
  }

  if (loading) {
    return <div className="h-48 bg-card rounded-lg animate-pulse" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-brand-500/10 flex items-center justify-center">
          <Link2 className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Enlaces</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tus enlaces de tracking con UTM y recursos varios listos para compartir
          </p>
        </div>
      </div>

      {/* ============ ENLACES CON UTM (tracking por usuario) ============ */}
      {isTrackedRole && (!userCode ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Tu código de tracking aún no está generado, contacta con un administrador.
        </div>
      ) : generatedLinks.length === 0 ? (
        <div className="rounded-lg border border-border bg-card/40 p-6 text-center">
          <Link2 className="w-8 h-8 text-muted-foreground mb-3 mx-auto" />
          <h3 className="text-sm font-medium text-foreground mb-1">
            {user?.role === 'affiliate' ? 'Aún no tienes campañas asignadas' : 'No hay plantillas de enlaces disponibles'}
          </h3>
          <p className="text-muted-foreground text-xs">
            {user?.role === 'affiliate'
              ? 'Cuando te asignen a una campaña, tus enlaces aparecerán aquí.'
              : 'Contacta con un administrador para configurar plantillas de enlaces.'}
          </p>
        </div>
      ) : (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Tus enlaces con tracking</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {generatedLinks.map(({ id, name, url }) => (
              <div key={id} className="rounded-lg border border-border bg-card p-4 space-y-3">
                <p className="text-foreground font-medium">{name}</p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 bg-muted border border-border rounded-md px-3 py-2 text-xs font-mono text-foreground truncate"
                  />
                  <Button variant="outline" size="icon" onClick={() => handleCopy(id, url)} title="Copiar">
                    {copiedId === id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* ============ RECURSOS VARIOS (sin UTM, por división) ============ */}
      {activeGrouped.length > 0 && (
        <div className="pt-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Recursos y enlaces varios</h2>
          <div className="space-y-5">
            {activeGrouped.map((group) => (
              <div key={group.id ?? '__none__'}>
                <div className="flex items-center gap-2 mb-2">
                  <FolderOpen className="w-4 h-4 text-brand-400" />
                  <h3 className="text-sm font-semibold text-foreground">{group.name}</h3>
                  <span className="text-xs text-muted-foreground">({group.items.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {group.items.map((r) => (
                    <div key={r.id} className="rounded-lg border border-border bg-card p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-foreground font-medium leading-tight">{r.name}</p>
                        <a href={r.url} target="_blank" rel="noopener noreferrer" title="Abrir">
                          <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-brand-400 shrink-0" />
                        </a>
                      </div>
                      {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          value={r.url}
                          onFocus={(e) => e.currentTarget.select()}
                          className="flex-1 min-w-0 bg-muted border border-border rounded-md px-3 py-1.5 text-xs font-mono text-foreground truncate"
                        />
                        <Button variant="outline" size="icon" onClick={() => handleCopy(r.id, r.url)} title="Copiar">
                          {copiedId === r.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============ GESTIÓN ADMIN: PLANTILLAS UTM ============ */}
      {canManage && (
        <div className="space-y-4 pt-6 border-t border-border">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Plantillas de enlaces (UTM)</h2>
              <p className="text-muted-foreground text-sm">Plantillas base a partir de las cuales se generan los enlaces con tracking por usuario</p>
            </div>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />
              Añadir plantilla
            </Button>
          </div>

          {allTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border border-border rounded-lg">
              <Link2 className="w-10 h-10 text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm mb-4">No hay plantillas configuradas</p>
              <Button onClick={openCreate} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Añadir plantilla
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
              {allTemplates.map((template) => (
                <div key={template.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-foreground font-medium">{template.name}</p>
                      <Badge
                        variant={template.is_active ? 'success' : 'secondary'}
                        className="cursor-pointer"
                        onClick={() => toggleActive(template)}
                      >
                        {template.is_active ? 'Activa' : 'Inactiva'}
                      </Badge>
                      {template.applies_to?.map((r) => (
                        <Badge key={r} variant="outline" className="text-xs">
                          {ROLE_LABELS[r as AppRole] ?? r}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-muted-foreground text-xs font-mono mt-1 truncate">{template.base_url}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-muted-foreground hover:text-foreground"
                      onClick={() => openEdit(template)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-muted-foreground hover:text-red-400"
                      onClick={() => handleDelete(template)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ GESTIÓN ADMIN: RECURSOS VARIOS + DIVISIONES ============ */}
      {canManage && (
        <div className="space-y-4 pt-6 border-t border-border">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Recursos y enlaces varios</h2>
              <p className="text-muted-foreground text-sm">Organiza los enlaces (sin UTM) en divisiones: pagos de productos, playbook, accesos a plataformas…</p>
            </div>
            {!resourceTableMissing && (
              <Button onClick={() => openResCreate()}>
                <Plus className="w-4 h-4 mr-2" />
                Añadir enlace
              </Button>
            )}
          </div>

          {resourceTableMissing ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-amber-300/90">
                <Database className="w-4 h-4 shrink-0" />
                Primero crea las tablas de recursos en la base de datos.
              </div>
              <Button variant="outline" size="sm" onClick={runResourceMigration} disabled={migrating}>
                {migrating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                Aplicar migración
              </Button>
            </div>
          ) : (
            <>
              {/* Gestión de divisiones */}
              <div className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FolderPlus className="w-4 h-4 text-brand-400" />
                  <span className="text-sm font-semibold text-foreground">Divisiones</span>
                  <span className="text-xs text-muted-foreground">Crea carpetas para agrupar los enlaces</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={newDivisionName}
                    onChange={(e) => setNewDivisionName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') createDivision() }}
                    className="bg-muted border-border h-9"
                    placeholder="Nombre de la división (ej: Enlaces de ventas)"
                  />
                  <Button onClick={createDivision} disabled={savingDivision || !newDivisionName.trim()}>
                    {savingDivision ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                    Crear división
                  </Button>
                </div>
                {divisions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {divisions.map((d) => (
                      <div key={d.id} className="flex items-center gap-1 bg-muted border border-border rounded-md pl-3 pr-1 py-1">
                        {editingDivisionId === d.id ? (
                          <>
                            <input
                              value={editingDivisionName}
                              onChange={(e) => setEditingDivisionName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveDivisionName(d.id)
                                if (e.key === 'Escape') { setEditingDivisionId(null); setEditingDivisionName('') }
                              }}
                              autoFocus
                              className="bg-card border border-border rounded px-2 py-0.5 text-sm text-foreground w-40"
                            />
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-emerald-400" onClick={() => saveDivisionName(d.id)}>
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => { setEditingDivisionId(null); setEditingDivisionName('') }}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <FolderOpen className="w-3.5 h-3.5 text-brand-400" />
                            <span className="text-sm text-foreground">{d.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {resources.filter((r) => r.division_id === d.id).length}
                            </span>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => { setEditingDivisionId(d.id); setEditingDivisionName(d.name) }}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-400" onClick={() => deleteDivision(d)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Enlaces agrupados por división */}
              {resources.length === 0 && divisions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center border border-border rounded-lg">
                  <FolderOpen className="w-10 h-10 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground text-sm mb-4">Crea una división y empieza a añadir enlaces</p>
                  <Button onClick={() => openResCreate()} size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Añadir enlace
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {adminGrouped.map((group) => (
                    <div key={group.id ?? '__none__'} className="rounded-lg border border-border overflow-hidden">
                      <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-card/60 border-b border-border">
                        <div className="flex items-center gap-2">
                          <FolderOpen className="w-4 h-4 text-brand-400" />
                          <span className="text-sm font-semibold text-foreground">{group.name}</span>
                          <span className="text-xs text-muted-foreground">({group.items.length})</span>
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" onClick={() => openResCreate(group.id)}>
                          <Plus className="w-3.5 h-3.5 mr-1" />
                          Añadir aquí
                        </Button>
                      </div>
                      {group.items.length === 0 ? (
                        <p className="px-4 py-3 text-xs text-muted-foreground">División vacía. Usa &quot;Añadir aquí&quot; para meter enlaces.</p>
                      ) : (
                        <div className="divide-y divide-border">
                          {group.items.map((r) => (
                            <div key={r.id} className="p-4 flex items-center justify-between gap-4">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-foreground font-medium">{r.name}</p>
                                  <Badge
                                    variant={r.is_active ? 'success' : 'secondary'}
                                    className="cursor-pointer"
                                    onClick={() => toggleResActive(r)}
                                  >
                                    {r.is_active ? 'Activo' : 'Inactivo'}
                                  </Badge>
                                  {(r.applies_to ?? []).length === 0 ? (
                                    <Badge variant="outline" className="text-xs">Todos</Badge>
                                  ) : (
                                    r.applies_to.map((role) => (
                                      <Badge key={role} variant="outline" className="text-xs">
                                        {ROLE_LABELS[role as AppRole] ?? role}
                                      </Badge>
                                    ))
                                  )}
                                </div>
                                {r.description && <p className="text-muted-foreground text-xs mt-0.5">{r.description}</p>}
                                <p className="text-muted-foreground text-xs font-mono mt-1 truncate">{r.url}</p>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-foreground" onClick={() => openResEdit(r)}>
                                  <Pencil className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-red-400" onClick={() => handleResDelete(r)}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Dialog: plantilla UTM */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent className="bg-card border-border text-foreground max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar plantilla' : 'Añadir plantilla'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-muted border-border"
                placeholder="Ej: Landing VSL"
              />
            </div>

            <div className="space-y-2">
              <Label>URL base *</Label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="bg-muted border-border"
                placeholder="https://iawinners.com/landing"
              />
              <p className="text-xs text-muted-foreground">
                Se añadirá automáticamente utm_term (setter/cold caller) o utm_content (afiliado) con el código de cada usuario.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Aplica a *</Label>
              <div className="grid grid-cols-2 gap-2">
                {LINK_ROLES.map((role) => (
                  <label
                    key={role}
                    className="flex items-center gap-2 text-sm text-foreground bg-muted/60 border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-muted"
                  >
                    <Checkbox
                      checked={appliesTo.includes(role)}
                      onCheckedChange={() => toggleAppliesTo(role)}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <Checkbox
                id="template-active"
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked === true)}
              />
              <Label htmlFor="template-active" className="cursor-pointer">Plantilla activa</Label>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || !name || !baseUrl || appliesTo.length === 0}>
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : editingId ? (
                  'Guardar cambios'
                ) : (
                  'Crear plantilla'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: recurso vario */}
      <Dialog
        open={resDialogOpen}
        onOpenChange={(open) => {
          setResDialogOpen(open)
          if (!open) resetResForm()
        }}
      >
        <DialogContent className="bg-card border-border text-foreground max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{resEditingId ? 'Editar enlace' : 'Añadir enlace'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-2">
              <Label>División / carpeta</Label>
              <Select value={resDivisionId} onValueChange={setResDivisionId}>
                <SelectTrigger className="bg-muted border-border">
                  <SelectValue placeholder="Elige una división" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_DIVISION}>Sin división</SelectItem>
                  {divisions.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {divisions.length === 0 && (
                <p className="text-xs text-amber-400/80">Aún no hay divisiones. Créalas arriba para organizar los enlaces.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Nombre *</Label>
              <Input
                value={resName}
                onChange={(e) => setResName(e.target.value)}
                className="bg-muted border-border"
                placeholder="Ej: Pago Programa Élite"
              />
            </div>

            <div className="space-y-2">
              <Label>URL *</Label>
              <Input
                value={resUrl}
                onChange={(e) => setResUrl(e.target.value)}
                className="bg-muted border-border"
                placeholder="https://..."
              />
            </div>

            <div className="space-y-2">
              <Label>Mini descripción</Label>
              <Textarea
                value={resDescription}
                onChange={(e) => setResDescription(e.target.value)}
                className="bg-muted border-border"
                rows={2}
                placeholder="Breve nota sobre para qué es este enlace"
              />
            </div>

            <div className="space-y-2">
              <Label>Visible para</Label>
              <p className="text-xs text-muted-foreground -mt-1">Si no marcas ninguno, lo verán todos los que acceden a Enlaces.</p>
              <div className="grid grid-cols-2 gap-2">
                {RESOURCE_ROLES.map((role) => (
                  <label
                    key={role}
                    className="flex items-center gap-2 text-sm text-foreground bg-muted/60 border border-border rounded-md px-3 py-2 cursor-pointer hover:bg-muted"
                  >
                    <Checkbox
                      checked={resAppliesTo.includes(role)}
                      onCheckedChange={() => toggleResAppliesTo(role)}
                    />
                    {ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
              <Checkbox
                id="resource-active"
                checked={resActive}
                onCheckedChange={(checked) => setResActive(checked === true)}
              />
              <Label htmlFor="resource-active" className="cursor-pointer">Enlace activo</Label>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setResDialogOpen(false)} disabled={resSubmitting}>
                Cancelar
              </Button>
              <Button onClick={handleResSubmit} disabled={resSubmitting || !resName || !resUrl}>
                {resSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Guardando...
                  </>
                ) : resEditingId ? (
                  'Guardar cambios'
                ) : (
                  'Crear enlace'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
