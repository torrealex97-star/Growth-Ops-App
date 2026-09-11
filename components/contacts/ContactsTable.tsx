"use client"

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from '@tanstack/react-table'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ArrowUpDown, ExternalLink } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { Contact } from '@/lib/types/database'
import { useTenant } from '@/lib/tenant-context'
import { SearchBox, normalizeText, phoneMatches } from '@/components/ui/search-box'

const columnHelper = createColumnHelper<Contact>()
const coreRowModel = getCoreRowModel()
const sortedRowModel = getSortedRowModel()
const filteredRowModel = getFilteredRowModel()

interface ContactsTableProps {
  contacts: Contact[]
}

export function ContactsTable({ contacts }: ContactsTableProps) {
  const tenant = useTenant()
  const router = useRouter()
  const [globalFilter, setGlobalFilter] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])

  const columns = useMemo(() => [
    columnHelper.accessor('full_name', {
      header: ({ column }) => (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 h-8"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Nombre completo
          <ArrowUpDown className="ml-2 h-3 w-3" />
        </Button>
      ),
      cell: ({ getValue }) => (
        <span className="font-medium text-foreground">{getValue() || '—'}</span>
      ),
    }),
    columnHelper.accessor('email', {
      header: 'Email',
      cell: ({ getValue }) => (
        <span className="text-foreground">{getValue() || '—'}</span>
      ),
    }),
    columnHelper.accessor('phone', {
      header: 'Teléfono',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{getValue() || '—'}</span>
      ),
    }),
    columnHelper.accessor('country', {
      header: 'País',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground">{getValue() || '—'}</span>
      ),
    }),
    columnHelper.accessor('first_seen_at', {
      header: 'Primera vez visto',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-sm">{formatDate(getValue())}</span>
      ),
    }),
    columnHelper.accessor('last_seen_at', {
      header: 'Última vez visto',
      cell: ({ getValue }) => (
        <span className="text-muted-foreground text-sm">{formatDate(getValue())}</span>
      ),
    }),
    columnHelper.accessor('id', {
      header: 'Acciones',
      cell: ({ getValue }) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-brand-400 hover:text-brand-300"
          onClick={(e) => {
            e.stopPropagation()
            router.push(`/${tenant}/contacts/${getValue()}`)
          }}
        >
          <ExternalLink className="w-3 h-3 mr-1" />
          Ver
        </Button>
      ),
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [])

  const filteredContacts = useMemo(() => {
    if (!globalFilter) return contacts
    const query = normalizeText(globalFilter.trim())
    return contacts.filter(
      (c) =>
        normalizeText(c.full_name || '').includes(query) ||
        normalizeText(c.email || '').includes(query) ||
        phoneMatches(c.phone, globalFilter)
    )
  }, [contacts, globalFilter])

  const table = useReactTable({
    data: filteredContacts,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: coreRowModel,
    getSortedRowModel: sortedRowModel,
    getFilteredRowModel: filteredRowModel,
  })

  return (
    <div className="space-y-4">
      <SearchBox value={globalFilter} onChange={setGlobalFilter} placeholder="Buscar por nombre, email o teléfono..." className="w-full" />

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-border hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="text-muted-foreground">
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-12 text-muted-foreground">
                  No se encontraron contactos
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="border-border hover:bg-card/50 cursor-pointer"
                  onClick={() => router.push(`/${tenant}/contacts/${row.original.id}`)}
                >
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

      <p className="text-xs text-muted-foreground">
        {filteredContacts.length} de {contacts.length} contactos
      </p>
    </div>
  )
}
