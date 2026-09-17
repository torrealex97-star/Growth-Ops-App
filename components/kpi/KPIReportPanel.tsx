'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KPIForm } from '@/components/kpi/KPIForm'
import { Button } from '@/components/ui/button'
import { CalendarPopover } from '@/components/ui/calendar-popover'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ClipboardList, Edit2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import type { KpiFormTemplate, KpiDailyReport } from '@/lib/types/database'
import { isLeadership, type AppRole } from '@/lib/auth/permissions'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { DEFAULT_PERIOD,  getPeriodRange, inPeriod, type PeriodPreset } from '@/lib/filters/period'
import { buildAutoValues, autoFieldKeys } from '@/lib/kpi/auto'
import { Sparkles } from 'lucide-react'
import { useSesion, useTenant, useTenantId } from '@/lib/tenant-context'

type MemberOption = { id: string; full_name: string }
type KpiDailyReportWithUser = KpiDailyReport & { users?: { full_name: string } | null }

export function KPIReportPanel() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  // Sesión ya resuelta por el layout: evita repetir auth.getUser() + from('users') aquí.
  const sesion = useSesion()
  const [templates, setTemplates] = useState<KpiFormTemplate[]>([])
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [existingReport, setExistingReport] = useState<KpiDailyReport | null>(null)
  const [recentReports, setRecentReports] = useState<KpiDailyReportWithUser[]>([])
  const [loading, setLoading] = useState(true)
  const [readOnly, setReadOnly] = useState(false)
  const [currentUserId, setCurrentUserId] = useState('')
  const [currentRoleKey, setCurrentRoleKey] = useState('')
  const [isLead, setIsLead] = useState(false)
  const [members, setMembers] = useState<MemberOption[]>([])
  const [autoValues, setAutoValues] = useState<Record<string, number>>({})
  const [autoFields, setAutoFields] = useState<Set<string>>(new Set())
  const [fullyAuto, setFullyAuto] = useState(false)

  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [member, setMember] = useState<string>('all')

  const range = useMemo(() => getPeriodRange(periodPreset, customFrom, customTo), [periodPreset, customFrom, customTo])
  const hasActiveFilters = periodPreset !== 'all' || member !== 'all'
  const clearFilters = () => {
    setPeriodPreset('all')
    setCustomFrom('')
    setCustomTo('')
    setMember('all')
  }

  const fetchData = async (date: string) => {
    setLoading(true)
    const supabase = createClient()

    // DOS VIAJES DE RED MENOS, en serie: el layout ya trajo la sesión y la fila de `users`.
    // Y este `return` ahora apaga el loader: antes salía sin apagarlo después de un setLoading(true),
    // que es la misma forma exacta del bug de la pantalla colgada.
    if (!sesion) {
      setLoading(false)
      return
    }

    setCurrentUserId(sesion.userId)
    const role = sesion.rol ?? ''
    setCurrentRoleKey(role)
    const lead = role ? isLeadership(role as AppRole) : false
    setIsLead(lead)

    const [templatesRes, reportRes, recentRes, membersRes] = await Promise.all([
      supabase
        .from('kpi_form_templates')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('role_key', role)
        .eq('is_active', true)
        .order('sort_order'),
      supabase
        .from('kpi_daily_reports')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', sesion.userId)
        .eq('report_date', date)
        .single(),
      lead
        ? supabase
            .from('kpi_daily_reports')
            .select('*, users(full_name)')
            .eq('tenant_id', tenantId)
            .order('report_date', { ascending: false })
            .limit(500)
        : supabase
            .from('kpi_daily_reports')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('user_id', sesion.userId)
            .order('report_date', { ascending: false })
            .limit(14),
      lead ? supabase.from('users').select('id, full_name').eq('is_active', true) : Promise.resolve({ data: null }),
    ])

    const tpls = templatesRes.data ?? []
    setTemplates(tpls)

    // Campos automáticos para este rol + métricas calculadas desde la app.
    const autoKeys = autoFieldKeys(role)
    setAutoFields(autoKeys)
    const manualCount = tpls.filter((t) => !autoKeys.has(t.field_key)).length
    const isFullyAuto = tpls.length > 0 && manualCount === 0
    setFullyAuto(isFullyAuto)

    let auto: Record<string, number> = {}
    if (autoKeys.size > 0) {
      try {
        const res = await fetch(`/api/${tenant}/evergreen/kpi/auto?date=${date}`)
        const d = await res.json()
        if (res.ok && d.metrics) auto = buildAutoValues(role, d.metrics)
      } catch {
        /* si falla, los auto quedan a 0 */
      }
    }
    setAutoValues(auto)

    if (isFullyAuto) {
      // Rol 100% automático (closer): se genera y sincroniza solo con los datos
      // actuales cada vez que se abre; la persona no rellena nada.
      const payload = {
        user_id: sesion.userId,
        role_key: role,
        report_date: date,
        data: { ...(reportRes.data?.data as Record<string, unknown> | undefined), ...auto },
        submitted_at: new Date().toISOString(),
        tenant_id: tenantId,
      }
      const { data: saved } = await supabase
        .from('kpi_daily_reports')
        .upsert(payload, { onConflict: 'user_id,report_date' })
        .select('*')
        .single()
      setExistingReport((saved as KpiDailyReport) ?? (payload as unknown as KpiDailyReport))
      setReadOnly(true)
    } else if (reportRes.data) {
      setExistingReport(reportRes.data)
      setReadOnly(true)
    } else {
      setExistingReport(null)
      setReadOnly(false)
    }

    setRecentReports((recentRes.data as KpiDailyReportWithUser[] | null) ?? [])
    setMembers((membersRes.data as MemberOption[] | null) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    fetchData(selectedDate)
    // `sesion` entra en las dependencias: sin ella, la carga se quedaría con el valor capturado en el
    // primer render. Está memorizada en el layout, así que no provoca bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, tenantId, sesion])

  const filteredReports = useMemo(() => {
    return recentReports
      .filter((r) => inPeriod(r.report_date, range))
      .filter((r) => (member === 'all' ? true : r.user_id === member))
  }, [recentReports, range, member])

  const handleSubmit = async (data: Record<string, unknown>) => {
    const supabase = createClient()

    const payload = {
      user_id: currentUserId,
      role_key: currentRoleKey,
      report_date: selectedDate,
      data,
      submitted_at: new Date().toISOString(),
      tenant_id: tenantId,
    }

    const { error } = await supabase.from('kpi_daily_reports').upsert(payload, { onConflict: 'user_id,report_date' })

    if (error) {
      toast.error('Error al guardar el informe', { description: error.message })
      return
    }

    toast.success('Informe KPI guardado')
    fetchData(selectedDate)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">Registra tus métricas diarias</p>
        <CalendarPopover
          value={selectedDate}
          onChange={setSelectedDate}
          disablePast={false}
          label="Día del informe KPI"
          className="w-52 bg-card"
        />
      </div>

      {loading ? (
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <ClipboardList className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Sin formulario configurado</h3>
          <p className="text-muted-foreground text-sm">El administrador debe configurar los campos KPI para tu rol</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-semibold text-foreground">{formatDate(selectedDate)}</h2>
            {existingReport && readOnly && (
              <div className="flex items-center gap-3">
                <Badge variant="success">{fullyAuto ? 'Automático' : 'Enviado'}</Badge>
                {!fullyAuto && (
                  <Button variant="outline" size="sm" onClick={() => setReadOnly(false)}>
                    <Edit2 className="w-3 h-3 mr-2" />
                    Editar
                  </Button>
                )}
              </div>
            )}
          </div>

          {fullyAuto ? (
            <div className="mb-5 flex items-start gap-2 rounded-md border border-brand-500/30 bg-brand-500/10 px-3 py-2.5">
              <Sparkles className="w-4 h-4 text-brand-300 mt-0.5 shrink-0" />
              <p className="text-sm text-brand-200">
                Este informe se genera <b>automáticamente</b> con tus agendas y ventas registradas. No necesitas
                rellenar nada.
              </p>
            </div>
          ) : autoFields.size > 0 ? (
            <div className="mb-5 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5">
              <Sparkles className="w-4 h-4 text-brand-300 mt-0.5 shrink-0" />
              <p className="text-sm text-foreground">
                Las agendas y shows salen <b>automáticamente</b> de tus agendas. Solo rellena el resto (conversaciones,
                mensajes, etc.).
              </p>
            </div>
          ) : null}

          <KPIForm
            templates={templates}
            defaultValues={{ ...(existingReport?.data as Record<string, unknown> | undefined), ...autoValues }}
            onSubmit={handleSubmit}
            readOnly={readOnly}
            autoFields={autoFields}
            autoValues={autoValues}
          />
        </div>
      )}

      {/* Recent reports */}
      {recentReports.length > 0 && (
        <div className="space-y-3">
          {isLead && (
            <PeriodFilterBar
              preset={periodPreset}
              onPresetChange={setPeriodPreset}
              customFrom={customFrom}
              customTo={customTo}
              onCustomFromChange={setCustomFrom}
              onCustomToChange={setCustomTo}
              members={members}
              member={member}
              onMemberChange={setMember}
              memberLabel="Miembro"
              allMembersLabel="Todos los miembros"
              onClear={clearFilters}
              hasActiveFilters={hasActiveFilters}
            />
          )}

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="font-medium text-foreground text-sm">{isLead ? 'Informes' : 'Ultimos 14 dias'}</h3>
            </div>
            {filteredReports.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No hay informes en el periodo seleccionado.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-muted-foreground">Fecha</TableHead>
                    {isLead && <TableHead className="text-muted-foreground">Miembro</TableHead>}
                    <TableHead className="text-muted-foreground">Estado</TableHead>
                    <TableHead className="text-muted-foreground">Enviado a</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReports.map((r) => (
                    <TableRow
                      key={r.id}
                      className="border-border hover:bg-muted/50 cursor-pointer"
                      onClick={() => {
                        if (r.user_id === currentUserId) setSelectedDate(r.report_date)
                      }}
                    >
                      <TableCell className="text-foreground text-sm">{formatDate(r.report_date)}</TableCell>
                      {isLead && <TableCell className="text-foreground text-sm">{r.users?.full_name ?? '—'}</TableCell>}
                      <TableCell>
                        <Badge variant="success">Enviado</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {r.submitted_at ? formatDate(r.submitted_at) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
