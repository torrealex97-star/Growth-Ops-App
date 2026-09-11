"use client"

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatCurrency } from '@/lib/utils'
import type { CollectionWithRelations } from '@/lib/types/database'
import { useTenant } from '@/lib/tenant-context'

const columnHelper = createColumnHelper<CollectionWithRelations>()
const coreRowModel = getCoreRowModel()
const sortedRowModel = getSortedRowModel()

interface CollectionsTableProps {
  collections: CollectionWithRelations[]
}

export function CollectionsTable({ collections }: CollectionsTableProps) {
  const tenant = useTenant()
  const router = useRouter()

  const columns = useMemo(() => [
    columnHelper.accessor('collected_at', {
      header: 'Fecha',
      cell: ({ getValue }) => (
        <span className="text-foreground text-sm">{formatDate(getValue())}</span>
      ),
    }),
    columnHelper.display({
      id: 'sale',
      header: 'Venta',
      cell: ({ row }) => (
        <button
          className="text-brand-400 hover:text-brand-300 text-sm text-left"
          onClick={(e) => {
            e.stopPropagation()
            router.push(`/${tenant}/ventas/registro/${row.original.sale_id}`)
          }}
        >
          <p className="font-medium">{row.original.sales?.contacts?.full_name || '—'}</p>
          <p className="text-xs text-muted-foreground">{row.original.sales?.payment_plans?.name || ''}</p>
        </button>
      ),
    }),
    columnHelper.accessor('gross_amount', {
      header: 'Bruto',
      cell: ({ getValue }) => (
        <span className="text-foreground font-medium">{formatCurrency(getValue())}</span>
      ),
    }),
    columnHelper.accessor('commissionable_amount', {
      header: 'Comisionable',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{formatCurrency(getValue())}</span>
      ),
    }),
    columnHelper.accessor('payment_method', {
      header: 'Metodo',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-sm capitalize">{getValue() || '—'}</span>
      ),
    }),
    columnHelper.accessor('is_eligible_for_commission', {
      header: 'Elegible',
      cell: ({ getValue }) => (
        getValue()
          ? <Badge variant="success">Si</Badge>
          : <Badge variant="secondary">No</Badge>
      ),
    }),
    columnHelper.accessor('status', {
      header: 'Estado',
      cell: ({ getValue }) => {
        const s = getValue()
        return (
          <Badge variant={s === 'collected' ? 'success' : s === 'reversed' ? 'destructive' : 'warning'}>
            {s}
          </Badge>
        )
      },
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  const table = useReactTable({
    data: collections,
    columns,
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
                No se encontraron cobros
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="border-border hover:bg-card/50">
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
