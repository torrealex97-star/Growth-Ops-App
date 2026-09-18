'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ClipboardList, MessageSquareQuote } from 'lucide-react'
import { extraerRespuestas, tieneRespuestasEstructuradas } from '@/lib/metrics/respuestas-formulario'
import { labelFor, mapKey } from '@/lib/qualification'

// Panel del dashboard: "Qué responde la gente".
// FUENTE DE VERDAD (2026-09-17): `appointments.raw_payload` — el mismo lugar del que lee el drawer
// de cada agenda, así que el panel cuenta EXACTAMENTE lo que la persona ve al abrir una ficha.
// Antes leía `contacts.qualification`, columna que está vacía en la práctica (0 de 559 citas), y el
// panel mostraba "Sin respuestas de formulario todavía" con datos reales delante.
//
//   - Calendly (473 de 559): Q&A estructurado en `invitee.questions_and_answers` → distribución
//     por pregunta y % sobre el total de agendas CON formulario (no sobre leads, que mezclaría
//     agendas sin formulario en el denominador).
//   - GHL (86): texto libre en `notes`/`description`, sin pares pregunta/respuesta. NO se parte
//     por líneas fingiendo estructura: se lista el texto tal cual, etiquetado.
//
// Las claves reconocidas (ingresos, motivo, compromiso…) se agrupan con las etiquetas del negocio
// vía `mapKey`; las preguntas desconocidas (el formulario cambia de redacción) se agrupan tal cual.

type Row = {
  id: string
  contactName: string | null
  contactId: string | null
  source: string | null
  payload: unknown
}

// Preguntas que se muestran como distribución (categóricas). "motivo" va aparte (texto libre).
const DISTRIBUCION_KEYS = ['situacion', 'ingresos', 'compromiso', 'inversion', 'confirma_asistencia', 'vio_vsl']

function normVal(v: string): string {
  const s = v.trim()
  if (!s) return '—'
  return s.length > 40 ? s.slice(0, 40) + '…' : s
}

export function QualificationInsights() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => {
    let mounted = true
    async function load() {
      const supabase = createClient()
      // Solo las columnas que se consumen. Se leen los payloads crudos y se parsean en cliente
      // con el MISMO parser que usa el drawer (`extraerRespuestas`), fuente única de verdad.
      let query = supabase
        .from('appointments')
        .select('id, source, raw_payload, contacts:contact_id ( full_name )')
        .not('raw_payload', 'is', null)
        .order('created_at', { ascending: false })
        .limit(2000)
      const { data, error: err } = await query
      if (!mounted) return
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }
      setRows(
        (data || []).map((r: any) => ({
          id: r.id,
          contactName: r.contacts?.full_name ?? null,
          contactId: typeof r.contacts === 'object' && r.contacts && 'id' in r.contacts ? (r.contacts as any).id : null,
          source: r.source ?? null,
          payload: r.raw_payload,
        }))
      )
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  // Agregación: distribución por pregunta (pares pregunta/respuesta) + lista de textos libres (GHL).
  const { distribuciones, motivosLibres, conFormulario, estructuradas, total } = useMemo(() => {
    const distribuciones: { key: string; label: string; bars: { label: string; count: number }[]; total: number }[] = []
    const motivosLibres: { name: string; text: string }[] = []
    let conFormulario = 0
    let estructuradas = 0

    for (const r of rows) {
      const respuestas = extraerRespuestas(r.payload, r.source)
      if (respuestas.length === 0) continue
      conFormulario++
      const estructurada = tieneRespuestasEstructuradas(respuestas)
      if (estructurada) estructuradas++

      for (const { pregunta, respuesta } of respuestas) {
        if (!respuesta.trim()) continue
        const key = mapKey(pregunta)
        if (key === 'motivo') {
          if (motivosLibres.length < 12) motivosLibres.push({ name: r.contactName || '—', text: respuesta.trim() })
          continue
        }
        if (key && DISTRIBUCION_KEYS.includes(key)) {
          let dist = distribuciones.find((d) => d.key === key)
          if (!dist) {
            dist = { key, label: labelFor(key), bars: [], total: 0 }
            distribuciones.push(dist)
            // Mantener el orden de DISTRIBUCION_KEYS
            distribuciones.sort(
              (a, b) => DISTRIBUCION_KEYS.indexOf(a.key as never) - DISTRIBUCION_KEYS.indexOf(b.key as never)
            )
          }
          const label = normVal(respuesta)
          const bar = dist.bars.find((b) => b.label === label)
          if (bar) bar.count++
          else dist.bars.push({ label, count: 1 })
          dist.total++
        }
        // Claves no categóricas (telefono, instagram, edad…) no se grafican: son identificadores.
      }
    }

    for (const d of distribuciones) {
      d.bars.sort((a, b) => b.count - a.count)
      d.bars = d.bars.slice(0, 6)
    }
    return { distribuciones, motivosLibres, conFormulario, estructuradas, total: rows.length }
  }, [rows])

  if (loading) return <div className="h-48 animate-pulse bg-muted rounded-lg" />

  if (error) {
    return (
      <div>
        <h2 className="text-base font-bold text-foreground flex items-center gap-2 mb-1">
          <ClipboardList className="w-4 h-4 text-muted-foreground" /> Qué responde la gente
        </h2>
        <div className="dashboard-card p-6 text-sm text-red-400">
          No se pudieron leer las respuestas ({error}).{' '}
          <button className="underline hover:text-red-300" onClick={() => window.location.reload()}>
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  if (conFormulario === 0) {
    return (
      <div>
        <h2 className="text-base font-bold text-foreground flex items-center gap-2 mb-1">
          <ClipboardList className="w-4 h-4 text-muted-foreground" /> Qué responde la gente
        </h2>
        <p className="text-muted-foreground text-xs mb-4">
          Respuestas del formulario de agendamiento (GHL, Calendly, Typeform).
        </p>
        <div className="dashboard-card p-8 text-center text-sm text-muted-foreground">
          Sin respuestas de formulario todavía.
        </div>
      </div>
    )
  }

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

  return (
    <div>
      <h2 className="text-base font-bold text-foreground flex items-center gap-2 mb-1">
        <ClipboardList className="w-4 h-4 text-muted-foreground" /> Qué responde la gente
      </h2>
      <p className="text-muted-foreground text-xs mb-4">
        Respuestas del formulario de agendamiento (GHL, Calendly, Typeform). {conFormulario} agendas con formulario de{' '}
        {total} con payload ({pct(conFormulario, total)}%)
        {estructuradas < conFormulario
          ? ` · ${estructuradas} estructuradas + ${conFormulario - estructuradas} texto libre`
          : ''}
        .
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {distribuciones.map((d) => (
          <div key={d.key} className="dashboard-card p-4">
            <h3 className="text-sm font-medium text-foreground mb-3">
              {d.label} <span className="text-muted-foreground text-xs">({d.total} respuestas)</span>
            </h3>
            <div className="space-y-2">
              {d.bars.map((b) => {
                const p = pct(b.count, d.total)
                return (
                  <div key={b.label}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="text-foreground truncate pr-2" title={b.label}>
                        {b.label}
                      </span>
                      <span className="text-muted-foreground shrink-0">
                        {b.count} · {p}%
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${p}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {motivosLibres.length > 0 && (
          <div className="dashboard-card p-4 lg:col-span-2">
            <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <MessageSquareQuote className="w-4 h-4 text-muted-foreground" /> Últimos motivos (por qué quieren la
              llamada)
            </h3>
            <ul className="space-y-2.5">
              {motivosLibres.map((m, i) => (
                <li key={i} className="text-sm">
                  <span className="text-muted-foreground">{m.name}: </span>
                  <span className="text-foreground">&ldquo;{m.text}&rdquo;</span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground text-xs mt-3">
              De {estructuradas} agendas con formulario estructurado y {conFormulario - estructuradas} con texto libre
              (GHL no da pares pregunta/respuesta).
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
