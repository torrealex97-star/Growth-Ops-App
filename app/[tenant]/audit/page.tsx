"use client"

import { useState, useEffect, useMemo } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronDown, ChevronRight, Shield, X } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import type { AuditLog } from '@/lib/types/database'
import { useTenantId } from '@/lib/tenant-context'
import { getCustomDateRange, inPeriod } from '@/lib/filters/period'

const ENTITY_TYPES = ['sale', 'collection', 'refund', 'appointment', 'contact', 'commission', 'user']
const ACTIONS = ['create', 'update', 'delete', 'approve']

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-500/20 text-emerald-400',
  update: 'bg-blue-500/20 text-blue-400',
  delete: 'bg-red-500/20 text-red-400',
  approve: 'bg-brand-500/20 text-brand-400',
}

export default function AuditPage() {
  const tenantId = useTenantId()
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  // Filters
  const [entityFilter, setEntityFilter] = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    const fetchLogs = async () => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(500)

      if (error) {
        toast.error('Error al cargar el log de auditoria')
      } else {
        setLogs(data ?? [])
      }
      setLoading(false)
    }
    fetchLogs()
  }, [tenantId])

  const dateRange = useMemo(() => getCustomDateRange(dateFrom, dateTo), [dateFrom, dateTo])

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (entityFilter !== 'all' && l.entity_type !== entityFilter) return false
      if (actionFilter !== 'all' && l.action !== actionFilter) return false
      if ((dateFrom || dateTo) && !inPeriod(l.created_at, dateRange)) return false
      return true
    })
  }, [logs, entityFilter, actionFilter, dateFrom, dateTo, dateRange])

  const hasFilters = entityFilter !== 'all' || actionFilter !== 'all' || !!dateFrom || !!dateTo

  const renderDiff = (log: AuditLog) => {
    if (!log.old_values && !log.new_values) return null

    const keys = new Set([
      ...Object.keys(log.old_values ?? {}),
      ...Object.keys(log.new_values ?? {}),
    ])

    const changes: { key: string; old: unknown; new: unknown }[] = []
    keys.forEach((key) => {
      const oldVal = (log.old_values as Record<string, unknown> | null)?.[key]
      const newVal = (log.new_values as Record<string, unknown> | null)?.[key]
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({ key, old: oldVal, new: newVal })
      }
    })

    if (changes.length === 0) {
      return (
        <pre className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg border border-border overflow-auto max-h-40">
          {JSON.stringify(log.new_values || log.old_values, null, 2)}
        </pre>
      )
    }

    return (
      <div className="space-y-1">
        {changes.map(({ key, old: oldVal, new: newVal }) => (
          <div key={key} className="text-xs grid grid-cols-3 gap-2 bg-muted/50 px-3 py-2 rounded border border-border">
            <span className="text-muted-foreground font-mono">{key}</span>
            <span className="text-red-400 font-mono truncate">{JSON.stringify(oldVal) ?? '—'}</span>
            <span className="text-emerald-400 font-mono truncate">{JSON.stringify(newVal) ?? '—'}</span>
          </div>
        ))}
        {changes.length > 0 && (
          <div className="text-xs grid grid-cols-3 gap-2 px-3 text-muted-foreground">
            <span>Campo</span>
            <span>Antes</span>
            <span>Despues</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Auditoria</h1>
        <p className="text-muted-foreground text-sm mt-1">Registro de todas las acciones del sistema</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="w-40 bg-card border-border">
            <SelectValue placeholder="Entidad" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todas las entidades</SelectItem>
            {ENTITY_TYPES.map(e => (
              <SelectItem key={e} value={e} className="capitalize">{e}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-36 bg-card border-border">
            <SelectValue placeholder="Accion" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border">
            <SelectItem value="all">Todas las acciones</SelectItem>
            {ACTIONS.map(a => (
              <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-40 bg-card border-border"
        />
        <Input
          type="date"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-40 bg-card border-border"
        />
        {hasFilters && (
          <Button variant="ghost" onClick={() => { setEntityFilter('all'); setActionFilter('all'); setDateFrom(''); setDateTo('') }} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4 mr-1" /> Limpiar filtros
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-card rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Shield className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Sin registros</h3>
          <p className="text-muted-foreground text-sm">No hay entradas de auditoria que coincidan con los filtros</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground w-8"></TableHead>
                <TableHead className="text-muted-foreground">Fecha</TableHead>
                <TableHead className="text-muted-foreground">Actor</TableHead>
                <TableHead className="text-muted-foreground">Entidad</TableHead>
                <TableHead className="text-muted-foreground">ID</TableHead>
                <TableHead className="text-muted-foreground">Accion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((log) => (
                <>
                  <TableRow
                    key={log.id}
                    className="border-border hover:bg-card/50 cursor-pointer"
                    onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                  >
                    <TableCell className="text-muted-foreground">
                      {expandedRow === log.id
                        ? <ChevronDown className="w-4 h-4" />
                        : <ChevronRight className="w-4 h-4" />
                      }
                    </TableCell>
                    <TableCell className="text-foreground text-sm">{formatDateTime(log.created_at)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm font-mono">{log.actor_user_id?.slice(0, 8) || 'Sistema'}...</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="capitalize">{log.entity_type}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">{log.entity_id?.slice(0, 12)}...</TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${ACTION_COLORS[log.action] ?? 'bg-muted text-muted-foreground'}`}>
                        {log.action}
                      </span>
                    </TableCell>
                  </TableRow>

                  {expandedRow === log.id && (
                    <TableRow key={`${log.id}-expanded`} className="border-border bg-card/30">
                      <TableCell colSpan={6} className="py-3 px-6">
                        <p className="text-xs text-muted-foreground mb-2">Cambios:</p>
                        {renderDiff(log)}
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{filtered.length} de {logs.length} entradas</p>
    </div>
  )
}
