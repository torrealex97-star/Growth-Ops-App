'use client'

import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { formatCurrency, formatPercent, formatDate } from '@/lib/utils'
import type { CommissionWithRelations } from '@/lib/types/database'

// COMISIÓN DE LA PLATAFORMA (fee de pasarela) por fila. El motor ya comisiona sobre la base
// neta (comisionable − fee, migración 20260919100000): en las positivas el fee se deduce de la
// propia fila (comisionable del cobro − base neta); en las negativas se replica el mismo fee
// que descontó la positiva. Es el dato que pide el negocio: cuánto se lleva la pasarela que
// procesó el pago, visible para todo el equipo (no es información de otros lanes).

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  liquidated: 'Liquidada',
  cancelled: 'Cancelada',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  approved: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  liquidated: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  cancelled: 'bg-zinc-500/20 text-muted-foreground border-border/30',
}

const PARTICIPANT_COLORS: Record<string, string> = {
  setter: 'bg-amber-500/20 text-amber-400',
  closer: 'bg-emerald-500/20 text-emerald-400',
  affiliate: 'bg-zinc-500/20 text-muted-foreground',
}

// Fee de pasarela implícito en la fila: comisionable del cobro − base neta comisionada.
// NULL si no hay cobro embebido o la resta no cuadra (histórico previo a la base neta).
function feeDePasarela(c: CommissionWithRelations): number | null {
  const cobro = c.collections
  if (!cobro || c.direction !== 'positive') return null
  const fee = Number(cobro.commissionable_amount ?? 0) - Number(c.base_amount ?? 0)
  const fee2 = Math.round(fee * 100) / 100
  return fee2 > 0.009 ? fee2 : null
}

interface CommissionsTableProps {
  commissions: CommissionWithRelations[]
  canApprove?: boolean
  onApprove?: (ids: string[]) => void
}

const columnHelper = createColumnHelper<CommissionWithRelations>()
const coreRowModel = getCoreRowModel()
const sortedRowModel = getSortedRowModel()

export function CommissionsTable({ commissions, canApprove = false, onApprove }: CommissionsTableProps) {
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})

  const columns = useMemo(
    () => [
      ...(canApprove
        ? [
            columnHelper.display({
              id: 'select',
              header: ({ table }) => (
                <Checkbox
                  checked={table.getIsAllRowsSelected()}
                  onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
                  className="border-border"
                />
              ),
              cell: ({ row }) => (
                <Checkbox
                  checked={row.getIsSelected()}
                  onCheckedChange={(v) => row.toggleSelected(!!v)}
                  disabled={row.original.status !== 'pending'}
                  className="border-border"
                />
              ),
            }),
          ]
        : []),
      columnHelper.accessor('users', {
        header: 'Usuario',
        cell: ({ getValue }) => (
          <span className="text-foreground text-sm">{(getValue() as { full_name?: string })?.full_name || '—'}</span>
        ),
      }),
      columnHelper.accessor('participant_type', {
        header: 'Tipo',
        cell: ({ getValue }) => {
          const t = getValue()
          return <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${PARTICIPANT_COLORS[t]}`}>{t}</span>
        },
      }),
      columnHelper.accessor('sales', {
        header: 'Venta',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-sm">
            {(getValue() as { id?: string })?.id?.slice(0, 8) || '—'}...
          </span>
        ),
      }),
      columnHelper.accessor('base_amount', {
        header: 'Base',
        cell: ({ getValue }) => <span className="text-muted-foreground">{formatCurrency(getValue())}</span>,
      }),
      columnHelper.display({
        id: 'fee_pasarela',
        header: 'Comisión plataforma',
        cell: ({ row }) => {
          const fee = feeDePasarela(row.original)
          return (
            <span className={fee != null ? 'text-orange-400' : 'text-muted-foreground/40'}>
              {fee != null ? formatCurrency(fee) : '—'}
            </span>
          )
        },
      }),
      columnHelper.accessor('percent', {
        header: '%',
        cell: ({ getValue }) => <span className="text-muted-foreground">{formatPercent(getValue())}</span>,
      }),
      columnHelper.accessor('commission_amount', {
        header: 'Importe',
        cell: ({ row, getValue }) => (
          <span
            className={`font-medium ${row.original.direction === 'negative' ? 'text-red-400' : 'text-emerald-400'}`}
          >
            {row.original.direction === 'negative' ? '-' : ''}
            {formatCurrency(getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('liquidation_month', {
        header: 'Mes Liquidacion',
        cell: ({ getValue }) => <span className="text-muted-foreground text-sm">{formatDate(getValue())}</span>,
      }),
      columnHelper.accessor('status', {
        header: 'Estado',
        cell: ({ getValue }) => {
          const s = getValue()
          return <Badge className={`border text-xs ${STATUS_COLORS[s]}`}>{STATUS_LABELS[s]}</Badge>
        },
      }),
    ],
    [canApprove]
  )

  const table = useReactTable({
    data: commissions,
    columns,
    state: { rowSelection },
    enableRowSelection: (row) => row.original.status === 'pending',
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: coreRowModel,
    getSortedRowModel: sortedRowModel,
  })

  const selectedIds = Object.keys(rowSelection)
    .filter((k) => rowSelection[k])
    .map((k) => commissions[parseInt(k)]?.id)
    .filter(Boolean) as string[]

  return (
    <div className="space-y-3">
      {canApprove && selectedIds.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{selectedIds.length} seleccionadas</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onApprove?.(selectedIds)
              setRowSelection({})
            }}
          >
            Aprobar seleccionadas
          </Button>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="border-border hover:bg-transparent">
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="text-muted-foreground">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-12 text-muted-foreground">
                  No hay comisiones en esta categoria
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="border-border hover:bg-card/50">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
