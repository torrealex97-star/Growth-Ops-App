'use client'

import { useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ExternalLink, Trash2 } from 'lucide-react'
import { formatDate, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'
import type { SaleWithRelations, SaleStatus } from '@/lib/types/database'
import { useTenant } from '@/lib/tenant-context'

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

const columnHelper = createColumnHelper<SaleWithRelations>()
const coreRowModel = getCoreRowModel()
const sortedRowModel = getSortedRowModel()

interface SalesTableProps {
  sales: SaleWithRelations[]
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void
  isAdmin?: boolean
  onDeleted?: (saleId: string) => void
}

export function SalesTable({ sales, sorting = [], onSortingChange, isAdmin = false, onDeleted }: SalesTableProps) {
  const tenant = useTenant()
  const router = useRouter()

  const handleDelete = useCallback(
    async (e: React.MouseEvent, saleId: string) => {
      e.stopPropagation()
      if (!confirm('¿Eliminar esta venta? Esta acción no se puede deshacer. La agenda enlazada NO se borra.')) return
      // Server-side: borra comisiones/devoluciones/cobros y desenlaza contratos/eventos CSM/bajas
      // en el orden correcto (el delete directo desde el cliente fallaba por violación de FK en
      // cuanto la venta tenía algo colgando — cobro, comisión, contrato...).
      const res = await fetch(`/api/${tenant}/evergreen/sales/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Error al eliminar')
        return
      }
      toast.success('Venta eliminada')
      onDeleted?.(saleId)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [isAdmin, onDeleted]
  )

  const columns = useMemo(
    () => [
      columnHelper.accessor('sale_date', {
        header: 'Fecha',
        cell: ({ getValue }) => <span className="text-foreground text-sm">{formatDate(getValue())}</span>,
      }),
      columnHelper.display({
        id: 'contact',
        header: 'Contacto',
        cell: ({ row }) => {
          const c = row.original.contacts as {
            full_name?: string | null
            email?: string | null
            phone?: string | null
          } | null
          const contactInfo = [c?.email, c?.phone].filter(Boolean).join(' · ')
          return (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <button
                  className="text-brand-400 hover:text-brand-300 text-sm font-medium truncate"
                  onClick={(e) => {
                    e.stopPropagation()
                    router.push(`/${tenant}/crm/contactos/${row.original.contact_id}`)
                  }}
                >
                  {c?.full_name || '—'}
                </button>
                {(row.original as { attribution_conflict?: boolean }).attribution_conflict && (
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/40"
                    title="Conflicto de atribución: revisar quién se lleva la comisión"
                  >
                    ⚠ atrib.
                  </span>
                )}
              </div>
              {contactInfo && <div className="text-xs text-muted-foreground truncate">{contactInfo}</div>}
            </div>
          )
        },
      }),
      columnHelper.display({
        id: 'plan',
        header: 'Plan de Pago',
        cell: ({ row }) => <span className="text-foreground text-sm">{row.original.payment_plans?.name || '—'}</span>,
      }),
      columnHelper.accessor('gross_amount', {
        header: 'Importe Bruto',
        cell: ({ getValue }) => <span className="text-foreground font-medium">{formatCurrency(getValue())}</span>,
      }),
      columnHelper.accessor('expected_commissionable_amount', {
        header: 'Comisionable',
        cell: ({ getValue }) => <span className="text-muted-foreground text-sm">{formatCurrency(getValue())}</span>,
      }),
      columnHelper.display({
        id: 'setter',
        header: 'Setter',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{row.original.setter?.full_name || '—'}</span>
        ),
      }),
      columnHelper.display({
        id: 'closer',
        header: 'Closer',
        cell: ({ row }) => (
          <span className="text-muted-foreground text-sm">{row.original.closer?.full_name || '—'}</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: 'Estado',
        cell: ({ getValue }) => {
          const s = getValue()
          return <Badge className={`border text-xs ${STATUS_COLORS[s]}`}>{STATUS_LABELS[s]}</Badge>
        },
      }),
      columnHelper.display({
        id: 'actions',
        header: 'Acciones',
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-brand-400 hover:text-brand-300"
              onClick={(e) => {
                e.stopPropagation()
                router.push(`/${tenant}/ventas/registro/${row.original.id}`)
              }}
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              Ver
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={(e) => handleDelete(e, row.original.id)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            )}
          </div>
        ),
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
    ],
    [isAdmin, handleDelete]
  )

  const table = useReactTable({
    data: sales,
    columns,
    state: { sorting },
    onSortingChange: onSortingChange as
      ((updater: SortingState | ((old: SortingState) => SortingState)) => void) | undefined,
    getCoreRowModel: coreRowModel,
    getSortedRowModel: sortedRowModel,
  })

  return (
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
                No se encontraron ventas
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="border-border hover:bg-card/50 cursor-pointer"
                onClick={() => router.push(`/${tenant}/ventas/registro/${row.original.id}`)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
