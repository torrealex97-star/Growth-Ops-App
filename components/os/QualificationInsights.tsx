'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ClipboardList, MessageSquareQuote } from 'lucide-react'
import { QUALIFICATION_KEYS, labelFor, type Qualification } from '@/lib/qualification'
import { useTenantId } from '@/lib/tenant-context'

// Panel del dashboard: "Qué responde la gente".
// Agrega las respuestas del formulario (cualificación) guardadas a nivel de contacto:
//   - distribución por respuesta para las preguntas clave
//   - últimos motivos (texto libre) para leer literalmente qué dice la gente

type Row = { name: string; qualification: Qualification; at: string | null }

// Preguntas que se muestran como distribución (categóricas). "motivo" va aparte (texto libre).
const DISTRIBUTION_KEYS = QUALIFICATION_KEYS.filter((k) => k !== 'motivo')

function normVal(v: string): string {
  const s = v.trim()
  if (!s) return '—'
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

export function QualificationInsights() {
  const tenantId = useTenantId()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('contacts')
        .select('full_name, qualification, qualification_updated_at')
        .eq('tenant_id', tenantId)
        .not('qualification', 'is', null)
        .order('qualification_updated_at', { ascending: false })
        .limit(1000)
      if (!mounted) return
      setRows(
        (data || []).map((r: { full_name: string | null; qualification: Qualification | null; qualification_updated_at: string | null }) => ({
          name: r.full_name || '—',
          qualification: r.qualification || {},
          at: r.qualification_updated_at,
        }))
      )
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [])

  // Distribución de respuestas por pregunta clave.
  const distributions = useMemo(() => {
    return DISTRIBUTION_KEYS.map((key) => {
      const counts = new Map<string, number>()
      for (const r of rows) {
        const v = r.qualification[key]
        if (typeof v === 'string' && v.trim()) {
          const label = normVal(v)
          counts.set(label, (counts.get(label) || 0) + 1)
        }
      }
      const total = Array.from(counts.values()).reduce((a, b) => a + b, 0)
      const bars = Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
      return { key, bars, total }
    }).filter((d) => d.total > 0)
  }, [rows])

  // Últimos motivos (texto libre).
  const motivos = useMemo(() => {
    const out: { name: string; text: string }[] = []
    for (const r of rows) {
      const m = r.qualification['motivo']
      if (typeof m === 'string' && m.trim().length > 3) out.push({ name: r.name, text: m.trim() })
      if (out.length >= 12) break
    }
    return out
  }, [rows])

  return (
    <div>
      <h2 className="text-base font-bold text-foreground flex items-center gap-2 mb-1">
        <ClipboardList className="w-4 h-4 text-muted-foreground" /> Qué responde la gente
      </h2>
      <p className="text-muted-foreground text-xs mb-4">
        Respuestas del formulario de agendamiento. {rows.length} leads con formulario.
      </p>

      {loading ? (
        <div className="h-48 animate-pulse bg-muted rounded-lg" />
      ) : rows.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          Sin respuestas de formulario todavía.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {distributions.map((d) => (
            <div key={d.key} className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-sm font-medium text-foreground mb-3">{labelFor(d.key)}</h3>
              <div className="space-y-2">
                {d.bars.map((b) => {
                  const pct = d.total > 0 ? Math.round((b.count / d.total) * 100) : 0
                  return (
                    <div key={b.label}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-foreground truncate pr-2" title={b.label}>{b.label}</span>
                        <span className="text-muted-foreground shrink-0">{b.count} · {pct}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {motivos.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4 lg:col-span-2">
              <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
                <MessageSquareQuote className="w-4 h-4 text-muted-foreground" /> Últimos motivos (por qué quieren la llamada)
              </h3>
              <ul className="space-y-2.5">
                {motivos.map((m, i) => (
                  <li key={i} className="text-sm">
                    <span className="text-muted-foreground">{m.name}: </span>
                    <span className="text-foreground">&ldquo;{m.text}&rdquo;</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
