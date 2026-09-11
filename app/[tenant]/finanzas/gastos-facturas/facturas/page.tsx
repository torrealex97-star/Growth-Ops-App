'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FileText, ExternalLink, ClipboardCopy } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox, normalizeText } from '@/components/ui/search-box'

type Expense = {
  id: string
  concept: string
  category: string
  amount: number
  expense_date: string
  counterparty: string | null
  invoice_url: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  publicidad: 'Publicidad',
  sueldos: 'Sueldos',
  comisiones: 'Comisiones',
  herramientas: 'Herramientas',
  eventos: 'Eventos',
  cogs: 'COGS',
  otros: 'Otros',
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function FacturasPage() {
  const [items, setItems] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth())
  const [q, setQ] = useState('')

  const load = async () => {
    setLoading(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .not('invoice_url', 'is', null)
      .order('expense_date', { ascending: false })
    if (error) {
      toast.error('No se pudieron cargar las facturas', { description: error.message })
    }
    setItems((data as Expense[]) || [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const monthItems = useMemo(
    () => items.filter((e) => e.expense_date && e.expense_date.startsWith(month)),
    [items, month]
  )

  const totals = useMemo(() => {
    const count = monthItems.length
    const total = monthItems.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    return { count, total }
  }, [monthItems])

  const visible = useMemo(() => {
    const nq = normalizeText(q.trim())
    if (!nq) return monthItems
    return monthItems.filter(
      (e) =>
        normalizeText(e.concept || '').includes(nq) ||
        normalizeText(e.counterparty || '').includes(nq) ||
        normalizeText(CATEGORY_LABELS[e.category] || e.category).includes(nq)
    )
  }, [monthItems, q])

  const copyList = async () => {
    if (monthItems.length === 0) {
      toast.error('No hay facturas este mes para copiar')
      return
    }
    const lines = monthItems.map(
      (e) =>
        `${formatDate(e.expense_date)} - ${e.concept} - ${e.counterparty || 'Sin proveedor'} - ${formatCurrency(e.amount)}`
    )
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Listado copiado al portapapeles')
    } catch (err) {
      toast.error('No se pudo copiar el listado', { description: err instanceof Error ? err.message : undefined })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-brand-400" /> Facturas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Todas las facturas por mes — para la gestoría</p>
        </div>
        <div className="flex items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Buscar factura..." className="w-56" />
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-brand-500"
          />
          <button
            onClick={copyList}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground hover:border-brand-500"
          >
            <ClipboardCopy className="w-4 h-4 text-brand-400" /> Copiar listado
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-24 bg-card rounded-lg animate-pulse" />
            ))}
          </div>
          <div className="h-64 bg-card rounded-lg animate-pulse" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Nº de facturas del mes</p>
              <p className="text-xl font-bold text-foreground mt-1">{totals.count}</p>
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Importe total facturado</p>
              <p className="text-xl font-bold text-brand-400 mt-1">{formatCurrency(totals.total)}</p>
            </div>
          </div>

          <div className="bg-card/50 border border-border rounded-lg overflow-hidden">
            {visible.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {monthItems.length === 0
                  ? 'No hay facturas registradas para este mes'
                  : 'Ninguna factura coincide con la búsqueda'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">Concepto</th>
                    <th className="px-4 py-3 font-medium">Proveedor</th>
                    <th className="px-4 py-3 font-medium">Categoría</th>
                    <th className="px-4 py-3 font-medium">Importe</th>
                    <th className="px-4 py-3 font-medium">Fecha</th>
                    <th className="px-4 py-3 font-medium">Factura</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e.id} className="border-b border-border/50 hover:bg-card/50">
                      <td className="px-4 py-3 text-foreground">{e.concept}</td>
                      <td className="px-4 py-3 text-muted-foreground">{e.counterparty || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-1 rounded bg-muted text-foreground">
                          {CATEGORY_LABELS[e.category] || e.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium">{formatCurrency(e.amount)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(e.expense_date)}</td>
                      <td className="px-4 py-3">
                        {e.invoice_url ? (
                          <a
                            href={e.invoice_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-brand-400 hover:text-brand-300 inline-flex items-center gap-1"
                          >
                            Ver/Descargar <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
