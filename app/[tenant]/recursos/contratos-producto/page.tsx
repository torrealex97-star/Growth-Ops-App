'use client'

import { useEffect, useMemo, useState } from 'react'
import { FileText, ChevronDown, ChevronRight, Eye, Download } from 'lucide-react'
import { toast } from 'sonner'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import { useTenant } from '@/lib/tenant-context'

type ProductTemplate = {
  id: string
  name: string
  kind: 'alumno' | 'tomador'
  payment_method: string | null
  welcome_message: string | null
  body: string
}

const KIND_LABEL: Record<string, string> = {
  alumno: 'Alumno',
  tomador: 'Tomador (pagador)',
}

const KIND_STYLE: Record<string, string> = {
  alumno: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  tomador: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
}

const PAYMENT_LABEL: Record<string, string> = {
  reserva: 'Reserva',
  sequra: 'Financiación Sequra',
  autofinanciado: 'Autofinanciado',
  transferencia: 'Transferencia',
  stripe: 'Tarjeta (Stripe)',
}

export default function ContratosProductoPage() {
  const tenant = useTenant()
  const [templates, setTemplates] = useState<ProductTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/${tenant}/evergreen/contracts/templates/product`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error('No se pudieron cargar los contratos', { description: json.error })
          setLoading(false)
          return
        }
        setTemplates(json.templates ?? [])
      } catch {
        toast.error('No se pudieron cargar los contratos')
      }
      setLoading(false)
    }
    load()
  }, [])

  const filtered = useMemo(() => {
    const nq = normalizeText(q.trim())
    if (!nq) return templates
    return templates.filter((t) =>
      normalizeText(t.name).includes(nq) ||
      normalizeText(KIND_LABEL[t.kind] || t.kind).includes(nq) ||
      normalizeText(t.body).includes(nq)
    )
  }, [templates, q])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-brand-400" /> Contratos de producto
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Consulta el texto de los contratos del producto para enseñárselos al cliente antes de la venta. Solo lectura.
          </p>
        </div>
        <SearchBox value={q} onChange={setQ} placeholder="Buscar por nombre o contenido..." className="w-full sm:w-80" />
      </div>

      {loading ? (
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-10 text-center">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {templates.length === 0 ? 'Todavía no hay contratos de producto disponibles.' : 'Ningún contrato coincide con la búsqueda.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => {
            const open = openId === t.id
            return (
              <div key={t.id} className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="w-full flex items-center gap-3 px-4 py-3">
                  <button
                    onClick={() => setOpenId(open ? null : t.id)}
                    className="flex items-center gap-3 flex-1 text-left"
                  >
                    {open ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <span className="text-foreground font-medium flex-1">{t.name}</span>
                  </button>
                  {t.payment_method && (
                    <span className="text-[11px] px-2 py-0.5 rounded-md border border-border text-muted-foreground">
                      {PAYMENT_LABEL[t.payment_method] || t.payment_method}
                    </span>
                  )}
                  <span className={`text-[11px] px-2 py-0.5 rounded-md border ${KIND_STYLE[t.kind] || 'border-border text-foreground'}`}>
                    {KIND_LABEL[t.kind] || t.kind}
                  </span>
                  <a
                    href={`/api/${tenant}/evergreen/contracts/templates/${t.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Descargar plantilla en PDF"
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/60 shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" /> PDF
                  </a>
                </div>
                {open && (
                  <div className="border-t border-border px-4 py-4 bg-background/40">
                    {t.welcome_message && (
                      <div className="mb-4 rounded-lg border border-brand-500/20 bg-brand-500/10 p-3 text-sm text-brand-100">
                        {t.welcome_message}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground">
                      {t.body}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
