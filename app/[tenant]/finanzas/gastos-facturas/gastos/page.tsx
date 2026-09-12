'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { activeUserNamesQuery } from '@/lib/users'
import {
  Wallet,
  Plus,
  X,
  Sparkles,
  ShieldCheck,
  RefreshCw,
  Info,
  Edit2,
  Trash2,
  Paperclip,
  Download,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import { getCustomDateRange, getPreviousPeriodRange, inPeriod, type PeriodRange } from '@/lib/filters/period'
import { useTenant } from '@/lib/tenant-context'

type PeriodPreset = 'month' | 'today' | 'week' | 'quarter' | 'year' | 'custom'

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  month: 'Mes (selector arriba)',
  today: 'Hoy',
  week: 'Esta semana',
  quarter: 'Este trimestre',
  year: 'Este año',
  custom: 'Personalizado',
}

function getPeriodRange(
  preset: PeriodPreset,
  month: string,
  customFrom: string,
  customTo: string
): { from: Date | null; to: Date | null } {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)

  switch (preset) {
    case 'today': {
      return { from: startOfDay(now), to: endOfDay(now) }
    }
    case 'week': {
      const day = now.getDay() === 0 ? 7 : now.getDay()
      const monday = new Date(now)
      monday.setDate(now.getDate() - day + 1)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return { from: startOfDay(monday), to: endOfDay(sunday) }
    }
    case 'quarter': {
      const q = Math.floor(now.getMonth() / 3)
      const from = new Date(now.getFullYear(), q * 3, 1)
      const to = new Date(now.getFullYear(), q * 3 + 3, 0)
      return { from: startOfDay(from), to: endOfDay(to) }
    }
    case 'year': {
      const from = new Date(now.getFullYear(), 0, 1)
      const to = new Date(now.getFullYear(), 11, 31)
      return { from: startOfDay(from), to: endOfDay(to) }
    }
    case 'custom': {
      return getCustomDateRange(customFrom, customTo)
    }
    case 'month':
    default: {
      const [y, m] = month.split('-').map(Number)
      if (!y || !m) return { from: null, to: null }
      const from = new Date(y, m - 1, 1)
      const to = new Date(y, m, 0)
      return { from: startOfDay(from), to: endOfDay(to) }
    }
  }
}

function csvEscape(value: string): string {
  if (value == null) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const lines = [headers, ...rows].map((r) => r.map((c) => csvEscape(String(c))).join(','))
  const csv = '﻿' + lines.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const CATEGORIES = [
  { value: 'publicidad', label: 'Publicidad' },
  { value: 'sueldos', label: 'Sueldos' },
  { value: 'comisiones', label: 'Comisiones' },
  { value: 'herramientas', label: 'Herramientas' },
  { value: 'eventos', label: 'Eventos' },
  { value: 'cogs', label: 'COGS' },
  { value: 'otros', label: 'Otros' },
] as const

const STATUS_OPTIONS = [
  { value: 'pagado', label: 'Pagado' },
  { value: 'en_revision', label: 'En revisión' },
  { value: 'pendiente', label: 'Pendiente de pago' },
] as const

const STATUS_LABELS: Record<Expense['status'], string> = {
  pagado: 'Pagado',
  en_revision: 'En revisión',
  pendiente: 'Pendiente de pago',
}

const STATUS_COLORS: Record<Expense['status'], string> = {
  pagado: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/30',
  en_revision: 'bg-amber-500/20 text-amber-400 border-amber-500/30 hover:bg-amber-500/30',
  pendiente: 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30',
}

const FREQUENCIES = [
  { value: 'mensual', label: 'Mensual' },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'anual', label: 'Anual' },
  { value: 'puntual', label: 'Puntual' },
] as const

const PAYMENT_METHODS = [
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'domiciliacion', label: 'Domiciliación' },
] as const

type Expense = {
  id: string
  concept: string
  category: 'publicidad' | 'sueldos' | 'comisiones' | 'herramientas' | 'eventos' | 'cogs' | 'otros'
  subcategory: string | null
  amount: number
  expense_date: string
  recurring: boolean
  frequency: 'mensual' | 'trimestral' | 'anual' | 'puntual' | null
  payment_method: string | null
  status: 'pagado' | 'en_revision' | 'pendiente'
  counterparty: string | null
  person_id: string | null
  notes: string | null
  created_by: string | null
  invoice_url: string | null
  needs_review: boolean
  ai_extracted: Record<string, unknown> | null
  auto_source: string | null
}
type DbUser = { id: string; full_name: string }

type AiExtracted = {
  concept?: string
  amount?: number
  currency?: string
  original_amount?: number
  original_currency?: string
  fx_rate?: number
  vat?: number
  category?: Expense['category']
  counterparty?: string
  expense_date?: string
  suggested_person?: string
  confidence?: number
}

// Nota legible para dejar constancia de una conversión de moneda automática.
function currencyConversionNote(extracted: AiExtracted): string | null {
  if (
    !extracted.original_currency ||
    typeof extracted.original_amount !== 'number' ||
    typeof extracted.amount !== 'number'
  )
    return null
  return `Factura original en ${extracted.original_currency} ${extracted.original_amount.toFixed(2)} · convertido a ${extracted.amount.toFixed(2)} € (tasa ${extracted.fx_rate?.toFixed(4) ?? '?'})`
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const emptyForm = {
  concept: '',
  category: 'publicidad' as Expense['category'],
  subcategory: '',
  amount: '',
  expense_date: new Date().toISOString().slice(0, 10),
  recurring: false,
  frequency: 'puntual' as NonNullable<Expense['frequency']>,
  payment_method: 'transferencia',
  status: 'pagado' as Expense['status'],
  counterparty: '',
  person_id: '',
  notes: '',
}

const emptyEditForm = {
  concept: '',
  category: 'publicidad' as Expense['category'],
  subcategory: '',
  amount: '',
  expense_date: '',
  status: 'pagado' as Expense['status'],
  counterparty: '',
  notes: '',
}

// Extrae el path del objeto dentro del bucket 'facturas' a partir de una URL pública de Supabase Storage
function extractStoragePath(url: string): string | null {
  const marker = '/object/public/facturas/'
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length))
}

// Línea de variación vs el periodo anterior comparable. En gastos, subir es negativo (rojo)
// y bajar es positivo (verde) — al revés que en ingresos.
function KpiDelta({ current, previous, hasPrevious }: { current: number; previous: number; hasPrevious: boolean }) {
  if (!hasPrevious) {
    return <p className="text-[11px] text-muted-foreground mt-1">—</p>
  }
  if (previous === 0) {
    if (current === 0) return <p className="text-[11px] text-muted-foreground mt-1">Sin cambios</p>
    return <p className="text-[11px] text-red-400 mt-1">▲ nuevo vs periodo anterior</p>
  }
  const pct = ((current - previous) / previous) * 100
  const up = pct > 0.05
  const down = pct < -0.05
  const colorClass = up ? 'text-red-400' : down ? 'text-emerald-400' : 'text-muted-foreground'
  const arrow = up ? '▲' : down ? '▼' : '—'
  return (
    <p className={`text-[11px] mt-1 ${colorClass}`}>
      {arrow} {Math.abs(pct).toFixed(1)}% vs periodo anterior
    </p>
  )
}

export default function ExpensesPage() {
  const tenant = useTenant()
  const [items, setItems] = useState<Expense[]>([])
  const [users, setUsers] = useState<DbUser[]>([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonth())
  const [showNew, setShowNew] = useState(false)
  const [ne, setNe] = useState(emptyForm)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiFile, setAiFile] = useState<File | null>(null)
  const [aiExtracted, setAiExtracted] = useState<AiExtracted | null>(null)
  const [generating, setGenerating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [canManage, setCanManage] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [ee, setEe] = useState(emptyEditForm)
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [q, setQ] = useState('')
  const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null)
  const [bulkProgress, setBulkProgress] = useState<
    { name: string; status: 'analizando' | 'guardada' | 'error'; error?: string }[] | null
  >(null)
  const [attachingId, setAttachingId] = useState<string | null>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const [attachTargetId, setAttachTargetId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const supabase = createClient()
    const [eRes, uRes, authRes] = await Promise.all([
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
      activeUserNamesQuery(supabase),
      supabase.auth.getUser(),
    ])
    // Sin esto, un fallo de RLS al cargar gastos dejaba la pantalla vacía en silencio,
    // indistinguible de "no hay gastos este mes" (módulo de dinero, alto impacto si pasa
    // desapercibido).
    if (eRes.error) toast.error('Error al cargar los gastos', { description: eRes.error.message })
    setItems((eRes.data as Expense[]) || [])
    setUsers((uRes.data as DbUser[]) || [])

    if (authRes.data.user) {
      const { data: userData } = await supabase
        .from('users')
        .select('roles(key)')
        .eq('id', authRes.data.user.id)
        .single()
      const roleKey = (userData as { roles?: { key?: string } } | null)?.roles?.key
      setCanManage(roleKey === 'admin' || roleKey === 'director')
    }
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const periodRange = useMemo(
    () => getPeriodRange(periodPreset, month, customFrom, customTo),
    [periodPreset, month, customFrom, customTo]
  )

  const monthItems = useMemo(() => {
    if (periodPreset === 'month') {
      return items.filter((e) => e.expense_date && e.expense_date.startsWith(month))
    }
    return items.filter((e) => {
      if (!e.expense_date) return false
      const d = new Date(e.expense_date)
      if (periodRange.from && d < periodRange.from) return false
      if (periodRange.to && d > periodRange.to) return false
      return true
    })
  }, [items, month, periodPreset, periodRange])

  const periodFileTag = useMemo(() => {
    if (periodPreset === 'month') return month
    if (periodPreset === 'custom') {
      return `${customFrom || 'inicio'}_a_${customTo || 'fin'}`
    }
    return periodPreset
  }, [periodPreset, month, customFrom, customTo])

  const handleExportCSV = () => {
    const headers = [
      'Fecha',
      'Concepto',
      'Categoria',
      'Subcategoria',
      'Importe',
      'Estado',
      'Recurrente',
      'Frecuencia',
      'Metodo de pago',
      'Contraparte',
      'Notas',
    ]
    const rows = monthItems.map((e) => [
      formatDate(e.expense_date),
      e.concept,
      CATEGORIES.find((c) => c.value === e.category)?.label || e.category,
      e.subcategory ?? '',
      e.amount,
      STATUS_LABELS[e.status],
      e.recurring ? 'Si' : 'No',
      e.frequency ?? '',
      e.payment_method ?? '',
      e.counterparty ?? '',
      e.notes ?? '',
    ])
    downloadCSV(`gastos_${periodFileTag}.csv`, headers, rows)
  }

  const computeTotals = (list: Expense[]) => {
    const total = list.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    const pagado = list.filter((e) => e.status === 'pagado').reduce((s, e) => s + Number(e.amount || 0), 0)
    const enRevision = list.filter((e) => e.status === 'en_revision').reduce((s, e) => s + Number(e.amount || 0), 0)
    const pendiente = list.filter((e) => e.status === 'pendiente').reduce((s, e) => s + Number(e.amount || 0), 0)
    const recurrenteMensual = list
      .filter((e) => e.recurring && e.frequency === 'mensual')
      .reduce((s, e) => s + Number(e.amount || 0), 0)
    return { total, pagado, enRevision, pendiente, recurrenteMensual }
  }

  const totals = useMemo(() => computeTotals(monthItems), [monthItems])

  // Rango del periodo anterior (misma duración, desplazado hacia atrás) para la comparativa MoM.
  const previousPeriodRange: PeriodRange = useMemo(() => getPreviousPeriodRange(periodRange), [periodRange])
  const hasPreviousPeriod = previousPeriodRange.from !== null && previousPeriodRange.to !== null

  const previousItems = useMemo(() => {
    if (!hasPreviousPeriod) return []
    return items.filter((e) => inPeriod(e.expense_date, previousPeriodRange))
  }, [items, previousPeriodRange, hasPreviousPeriod])

  const previousTotals = useMemo(() => computeTotals(previousItems), [previousItems])

  // Filas visibles en la tabla según la búsqueda de texto (los totales se mantienen sobre el periodo).
  const visibleItems = useMemo(() => {
    const nq = normalizeText(q.trim())
    if (!nq) return monthItems
    return monthItems.filter(
      (e) =>
        normalizeText(e.concept || '').includes(nq) ||
        normalizeText(e.counterparty || '').includes(nq) ||
        normalizeText(e.subcategory || '').includes(nq) ||
        normalizeText(e.notes || '').includes(nq) ||
        normalizeText(CATEGORIES.find((c) => c.value === e.category)?.label || e.category).includes(nq)
    )
  }, [monthItems, q])

  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const e of monthItems) {
      map.set(e.category, (map.get(e.category) || 0) + Number(e.amount || 0))
    }
    return CATEGORIES.map((c) => ({ ...c, amount: map.get(c.value) || 0 }))
      .filter((c) => c.amount > 0)
      .sort((a, b) => b.amount - a.amount)
  }, [monthItems])

  const updateStatus = async (id: string, next: Expense['status']) => {
    const prev = items
    setItems((cur) => cur.map((e) => (e.id === id ? { ...e, status: next } : e)))
    const supabase = createClient()
    const { error } = await supabase.from('expenses').update({ status: next }).eq('id', id)
    if (error) {
      toast.error('No se pudo actualizar el estado', { description: error.message })
      setItems(prev)
    } else toast.success('Estado actualizado')
  }

  const resetNewModal = () => {
    setShowNew(false)
    setNe(emptyForm)
    setAiFile(null)
    setAiExtracted(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const readFileAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // strip the "data:<mime>;base64," prefix
        const base64 = result.split(',')[1] || result
        resolve(base64)
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })

  const handleInvoiceFile = async (file: File) => {
    setAiFile(file)
    setAnalyzing(true)
    try {
      const fileBase64 = await readFileAsBase64(file)
      const res = await fetch(`/api/${tenant}/evergreen/ai/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, mediaType: file.type }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        toast.error('No se pudo analizar la factura', { description: data?.error || res.statusText })
        return
      }
      const extracted: AiExtracted = data.extracted || {}
      setAiExtracted(extracted)

      // buscar persona sugerida por nombre (case-insensitive)
      let matchedPersonId = ''
      if (extracted.suggested_person) {
        const match = users.find(
          (u) => u.full_name.trim().toLowerCase() === extracted.suggested_person!.trim().toLowerCase()
        )
        if (match) matchedPersonId = match.id
      }

      const conversionNote = currencyConversionNote(extracted)
      setNe((prev) => ({
        ...prev,
        concept: extracted.concept ?? prev.concept,
        amount: extracted.amount !== undefined ? String(extracted.amount) : prev.amount,
        category: (extracted.category as Expense['category']) ?? prev.category,
        counterparty: extracted.counterparty ?? prev.counterparty,
        subcategory: extracted.counterparty ?? prev.subcategory,
        expense_date: extracted.expense_date ?? prev.expense_date,
        person_id: matchedPersonId || prev.person_id,
        notes: conversionNote ? [conversionNote, prev.notes].filter(Boolean).join(' · ') : prev.notes,
      }))
      if (conversionNote) toast.info(conversionNote)
      toast.success('Factura analizada — revisa los datos antes de crear')
    } catch (err) {
      toast.error('Error al analizar la factura', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setAnalyzing(false)
    }
  }

  // Analiza una factura con la IA y crea directamente el gasto (usado en la subida masiva,
  // donde no hay un formulario único que revisar antes de guardar cada una).
  const analyzeAndSaveInvoice = async (file: File): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      const fileBase64 = await readFileAsBase64(file)
      const res = await fetch(`/api/${tenant}/evergreen/ai/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, mediaType: file.type }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        return { ok: false, error: data?.error || res.statusText || 'Error desconocido' }
      }
      const extracted: AiExtracted = data.extracted || {}

      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      let invoiceUrl: string | null = null
      try {
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`
        const { error: uploadError } = await supabase.storage.from('facturas').upload(path, file)
        if (uploadError) {
          return { ok: false, error: `No se pudo subir el archivo: ${uploadError.message}` }
        }
        const { data: pub } = supabase.storage.from('facturas').getPublicUrl(path)
        invoiceUrl = pub?.publicUrl || path
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'No se pudo subir el archivo' }
      }

      let matchedPersonId: string | null = null
      if (extracted.suggested_person) {
        const match = users.find(
          (u) => u.full_name.trim().toLowerCase() === extracted.suggested_person!.trim().toLowerCase()
        )
        if (match) matchedPersonId = match.id
      }

      const { error } = await supabase.from('expenses').insert({
        concept: extracted.concept || file.name,
        category: (extracted.category as Expense['category']) || 'otros',
        subcategory: extracted.counterparty || null,
        amount: typeof extracted.amount === 'number' ? extracted.amount : 0,
        expense_date: extracted.expense_date || new Date().toISOString().slice(0, 10),
        recurring: false,
        frequency: null,
        payment_method: 'transferencia',
        status: 'pendiente',
        counterparty: extracted.counterparty || null,
        person_id: matchedPersonId,
        notes: currencyConversionNote(extracted),
        created_by: user?.id,
        invoice_url: invoiceUrl,
        needs_review: true,
        ai_extracted: extracted,
      })
      if (error) return { ok: false, error: error.message }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' }
    }
  }

  // Sube y analiza varias facturas seguidas. Cada una se guarda en cuanto se analiza; si una
  // falla no bloquea el resto.
  const handleBulkFiles = async (files: File[]) => {
    setBulkProgress(files.map((f) => ({ name: f.name, status: 'analizando' as const })))
    let okCount = 0
    for (let i = 0; i < files.length; i++) {
      const result = await analyzeAndSaveInvoice(files[i])
      setBulkProgress((prev) => {
        if (!prev) return prev
        const next = [...prev]
        next[i] = result.ok
          ? { name: files[i].name, status: 'guardada' }
          : { name: files[i].name, status: 'error', error: result.error }
        return next
      })
      if (result.ok) {
        okCount++
        load()
      }
    }
    if (okCount > 0)
      toast.success(`${okCount} factura${okCount === 1 ? '' : 's'} guardada${okCount === 1 ? '' : 's'} en Gastos`)
  }

  // Adjunta la factura real a un gasto YA creado (típicamente uno recurrente que el cron generó
  // el día 1 sin adjunto todavía): sube el archivo al mismo bucket y guarda invoice_url.
  const attachInvoiceToExpense = async (expenseId: string, file: File) => {
    setAttachingId(expenseId)
    try {
      const supabase = createClient()
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`
      const { error: uploadError } = await supabase.storage.from('facturas').upload(path, file)
      if (uploadError) {
        toast.error('No se pudo subir la factura', { description: uploadError.message })
        return
      }
      const { data: pub } = supabase.storage.from('facturas').getPublicUrl(path)
      const { error } = await supabase
        .from('expenses')
        .update({ invoice_url: pub?.publicUrl || path })
        .eq('id', expenseId)
      if (error) {
        toast.error('No se pudo adjuntar la factura', { description: error.message })
        return
      }
      toast.success('Factura adjuntada')
      load()
    } finally {
      setAttachingId(null)
      setAttachTargetId(null)
    }
  }

  const onAttachInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && attachTargetId) attachInvoiceToExpense(attachTargetId, file)
    if (attachInputRef.current) attachInputRef.current.value = ''
  }

  const onInvoiceInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length === 0) return
    if (files.length === 1) {
      setShowNew(true)
      handleInvoiceFile(files[0])
    } else {
      handleBulkFiles(files)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const create = async () => {
    if (!ne.concept.trim()) {
      toast.error('Pon un concepto')
      return
    }
    const amountNum = parseFloat(ne.amount)
    if (!ne.amount || isNaN(amountNum) || amountNum <= 0) {
      toast.error('Introduce un importe válido')
      return
    }
    if (!ne.expense_date) {
      toast.error('Selecciona una fecha')
      return
    }

    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    let invoiceUrl: string | null = null
    if (aiFile) {
      try {
        const path = `${Date.now()}-${aiFile.name}`
        const { error: uploadError } = await supabase.storage.from('facturas').upload(path, aiFile)
        if (uploadError) {
          toast.error('No se pudo subir la factura al storage', { description: uploadError.message })
        } else {
          const { data: pub } = supabase.storage.from('facturas').getPublicUrl(path)
          invoiceUrl = pub?.publicUrl || path
        }
      } catch (err) {
        toast.error('No se pudo subir la factura', { description: err instanceof Error ? err.message : undefined })
      }
    }

    const { error } = await supabase.from('expenses').insert({
      concept: ne.concept.trim(),
      category: ne.category,
      subcategory: ne.subcategory.trim() || null,
      amount: amountNum,
      expense_date: ne.expense_date,
      recurring: ne.recurring,
      frequency: ne.recurring ? ne.frequency : null,
      payment_method: ne.payment_method || null,
      status: ne.status,
      counterparty: ne.counterparty.trim() || null,
      person_id: ne.person_id || null,
      notes: ne.notes.trim() || null,
      created_by: user?.id,
      invoice_url: invoiceUrl,
      needs_review: !!aiExtracted,
      ai_extracted: aiExtracted || null,
    })
    if (error) {
      toast.error('Error al crear el gasto', { description: error.message })
      return
    }
    toast.success('Gasto creado')
    resetNewModal()
    load()
  }

  const toggleReview = async (id: string) => {
    setItems((prev) => prev.map((e) => (e.id === id ? { ...e, needs_review: false } : e)))
    const supabase = createClient()
    const { error } = await supabase.from('expenses').update({ needs_review: false }).eq('id', id)
    if (error) {
      toast.error('No se pudo confirmar el gasto')
      load()
    }
  }

  const openEdit = (e: Expense) => {
    setEditing(e)
    setEe({
      concept: e.concept,
      category: e.category,
      subcategory: e.subcategory || '',
      amount: String(e.amount),
      expense_date: e.expense_date ? e.expense_date.slice(0, 10) : '',
      status: e.status,
      counterparty: e.counterparty || '',
      notes: e.notes || '',
    })
  }

  const closeEdit = () => {
    setEditing(null)
    setEe(emptyEditForm)
  }

  const saveEdit = async () => {
    if (!editing) return
    if (!ee.concept.trim()) {
      toast.error('Pon un concepto')
      return
    }
    const amountNum = parseFloat(ee.amount)
    if (!ee.amount || isNaN(amountNum) || amountNum <= 0) {
      toast.error('Introduce un importe válido')
      return
    }
    if (!ee.expense_date) {
      toast.error('Selecciona una fecha')
      return
    }

    const supabase = createClient()
    const { error } = await supabase
      .from('expenses')
      .update({
        concept: ee.concept.trim(),
        category: ee.category,
        subcategory: ee.subcategory.trim() || null,
        amount: amountNum,
        expense_date: ee.expense_date,
        status: ee.status,
        counterparty: ee.counterparty.trim() || null,
        notes: ee.notes.trim() || null,
      })
      .eq('id', editing.id)
    if (error) {
      toast.error('Error al actualizar el gasto', { description: error.message })
      return
    }
    toast.success('Gasto actualizado')
    closeEdit()
    load()
  }

  const removeExpense = async (e: Expense) => {
    if (!confirm('¿Borrar este gasto? Esta acción no se puede deshacer.')) return
    const supabase = createClient()

    if (e.invoice_url) {
      const path = extractStoragePath(e.invoice_url)
      if (path) {
        const { error: storageError } = await supabase.storage.from('facturas').remove([path])
        if (storageError) {
          toast.error('No se pudo borrar el archivo de la factura, se borrará el gasto igualmente', {
            description: storageError.message,
          })
        }
      }
    }

    const prev = items
    setItems((cur) => cur.filter((it) => it.id !== e.id))
    const { error } = await supabase.from('expenses').delete().eq('id', e.id)
    if (error) {
      toast.error('No se pudo borrar el gasto', { description: error.message })
      setItems(prev)
    } else toast.success('Gasto borrado')
  }

  const generateMonth = async () => {
    setGenerating(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/cron/monthly`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        toast.error('No se pudieron generar los gastos del mes', { description: data?.error || res.statusText })
        return
      }
      toast.success(`Generados ${data.inserted} gastos de ${data.period}`)
      load()
    } catch (err) {
      toast.error('Error al generar los gastos del mes', {
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wallet className="w-6 h-6 text-brand-400" /> Gastos
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Costes operativos — base del P&L, burn rate y runway</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={periodPreset}
            onChange={(e) => setPeriodPreset(e.target.value as PeriodPreset)}
            className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-brand-500"
          >
            {(Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
          {periodPreset === 'month' && (
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-brand-500"
            />
          )}
          {periodPreset === 'custom' && (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-brand-500"
              />
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-brand-500"
              />
            </>
          )}
          <SearchBox value={q} onChange={setQ} placeholder="Buscar concepto, proveedor..." className="w-64" />
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground hover:border-brand-500"
          >
            <Download className="w-4 h-4 text-brand-400" /> Exportar CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={onInvoiceInputChange}
          />
          <input
            ref={attachInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={onAttachInputChange}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={analyzing || !!bulkProgress?.some((b) => b.status === 'analizando')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground hover:border-brand-500 disabled:opacity-60"
          >
            <Sparkles className="w-4 h-4 text-brand-400" /> {analyzing ? 'Analizando factura…' : 'Subir factura con IA'}
          </button>
          <button
            onClick={generateMonth}
            disabled={generating}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-muted border border-border text-foreground hover:border-brand-500 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 text-brand-400 ${generating ? 'animate-spin' : ''}`} />{' '}
            {generating ? 'Generando…' : 'Generar gastos del mes'}
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-500"
          >
            <Plus className="w-4 h-4" /> Nuevo gasto
          </button>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5" /> Los sueldos del equipo y los gastos recurrentes mensuales se generan
        automáticamente el día 1 de cada mes, o al pulsar &quot;Generar gastos del mes&quot;. Es idempotente: no duplica
        gastos ya generados.
      </p>

      {bulkProgress && (
        <div className="bg-card/50 border border-border rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-brand-400" /> Subida masiva de facturas
            </h3>
            {!bulkProgress.some((b) => b.status === 'analizando') && (
              <button onClick={() => setBulkProgress(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <ul className="space-y-1 text-xs">
            {bulkProgress.map((b, i) => (
              <li key={`${b.name}-${i}`} className="flex items-center gap-2">
                {b.status === 'analizando' && <span className="text-brand-300">Analizando…</span>}
                {b.status === 'guardada' && <span className="text-emerald-400">Guardada</span>}
                {b.status === 'error' && <span className="text-red-400">Error{b.error ? `: ${b.error}` : ''}</span>}
                <span className="text-muted-foreground truncate">{b.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-card rounded-lg animate-pulse" />
            ))}
          </div>
          <div className="h-64 bg-card rounded-lg animate-pulse" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total gastos</p>
              <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totals.total)}</p>
              <KpiDelta current={totals.total} previous={previousTotals.total} hasPrevious={hasPreviousPeriod} />
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total pagado</p>
              <p className="text-xl font-bold text-emerald-400 mt-1">{formatCurrency(totals.pagado)}</p>
              <KpiDelta current={totals.pagado} previous={previousTotals.pagado} hasPrevious={hasPreviousPeriod} />
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">En revisión</p>
              <p className="text-xl font-bold text-amber-400 mt-1">{formatCurrency(totals.enRevision)}</p>
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Total pendiente</p>
              <p className="text-xl font-bold text-red-400 mt-1">{formatCurrency(totals.pendiente)}</p>
              <KpiDelta
                current={totals.pendiente}
                previous={previousTotals.pendiente}
                hasPrevious={hasPreviousPeriod}
              />
            </div>
            <div className="bg-card/50 border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Gasto recurrente mensual</p>
              <p className="text-xl font-bold text-brand-400 mt-1">{formatCurrency(totals.recurrenteMensual)}</p>
              <KpiDelta
                current={totals.recurrenteMensual}
                previous={previousTotals.recurrenteMensual}
                hasPrevious={hasPreviousPeriod}
              />
            </div>
          </div>

          <div className="bg-card/50 border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">Desglose por categoría</h3>
            {byCategory.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin gastos este mes</p>
            ) : (
              <div className="space-y-3">
                {byCategory.map((c) => {
                  const pct = totals.total > 0 ? (c.amount / totals.total) * 100 : 0
                  return (
                    <div key={c.value}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-foreground font-medium">{c.label}</span>
                        <span className="text-muted-foreground">
                          {formatCurrency(c.amount)} · {pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="bg-card/50 border border-border rounded-lg overflow-hidden">
            {visibleItems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {monthItems.length === 0
                  ? 'No hay gastos registrados para este mes'
                  : 'Ningún gasto coincide con la búsqueda'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="px-4 py-3 font-medium">Concepto</th>
                    <th className="px-4 py-3 font-medium">Categoría</th>
                    <th className="px-4 py-3 font-medium">Importe</th>
                    <th className="px-4 py-3 font-medium">Fecha</th>
                    <th className="px-4 py-3 font-medium">Estado</th>
                    <th className="px-4 py-3 font-medium">Revisión</th>
                    {canManage && <th className="px-4 py-3 font-medium">Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((e) => {
                    const isExpanded = expandedInvoiceId === e.id
                    const isPdf = !!e.invoice_url && e.invoice_url.toLowerCase().split('?')[0].endsWith('.pdf')
                    return (
                      <Fragment key={e.id}>
                        <tr
                          onClick={() => setExpandedInvoiceId((cur) => (cur === e.id ? null : e.id))}
                          className="border-b border-border/50 hover:bg-card/50 cursor-pointer"
                        >
                          <td className="px-4 py-3 text-foreground">
                            {e.concept}
                            {e.recurring && (
                              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/30">
                                recurrente
                              </span>
                            )}
                            {e.auto_source && (
                              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                                auto
                              </span>
                            )}
                            {e.needs_review && (
                              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                Revisar
                              </span>
                            )}
                            {e.invoice_url && (
                              <span
                                title="Ver factura"
                                className={`ml-2 inline-flex items-center ${isExpanded ? 'text-brand-400' : 'text-muted-foreground'}`}
                              >
                                <Paperclip className="w-3.5 h-3.5" />
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs px-2 py-1 rounded bg-muted text-foreground">
                              {CATEGORIES.find((c) => c.value === e.category)?.label || e.category}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-foreground font-medium">{formatCurrency(e.amount)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{formatDate(e.expense_date)}</td>
                          <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                            <select
                              value={e.status}
                              onChange={(ev) => updateStatus(e.id, ev.target.value as Expense['status'])}
                              disabled={!canManage}
                              title={STATUS_LABELS[e.status]}
                              className={`text-xs pl-2 pr-6 py-1 rounded border transition-colors cursor-pointer disabled:cursor-default disabled:opacity-90 ${STATUS_COLORS[e.status]}`}
                            >
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s.value} value={s.value} className="bg-card text-foreground">
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                            {e.needs_review ? (
                              <button
                                onClick={() => toggleReview(e.id)}
                                className="text-xs px-2 py-1 rounded border bg-brand-500/20 text-brand-300 border-brand-500/30 hover:bg-brand-500/30 flex items-center gap-1"
                              >
                                <ShieldCheck className="w-3 h-3" /> Confirmar
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          {canManage && (
                            <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => openEdit(e)}
                                  title="Editar"
                                  className="text-muted-foreground hover:text-brand-400"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => removeExpense(e)}
                                  title="Borrar"
                                  className="text-muted-foreground hover:text-red-400"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                        {isExpanded && (
                          <tr className="border-b border-border/50 bg-muted/30">
                            <td colSpan={canManage ? 7 : 6} className="px-4 py-4">
                              {e.invoice_url ? (
                                isPdf ? (
                                  <iframe
                                    src={e.invoice_url}
                                    className="w-full h-[500px] rounded border border-border bg-white"
                                    title={`Factura ${e.concept}`}
                                  />
                                ) : (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={e.invoice_url}
                                    alt={`Factura ${e.concept}`}
                                    className="max-h-[500px] rounded border border-border"
                                  />
                                )
                              ) : (
                                <div className="flex items-center gap-3" onClick={(ev) => ev.stopPropagation()}>
                                  <p className="text-xs text-muted-foreground">Sin factura adjunta</p>
                                  {canManage && (
                                    <button
                                      onClick={() => {
                                        setAttachTargetId(e.id)
                                        attachInputRef.current?.click()
                                      }}
                                      disabled={attachingId === e.id}
                                      className="text-xs px-2 py-1 rounded-md border border-brand-500/30 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20 disabled:opacity-50"
                                    >
                                      {attachingId === e.id ? 'Subiendo…' : 'Subir factura'}
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={resetNewModal}>
          <div
            className="bg-card border border-border rounded-xl p-5 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Nuevo gasto</h3>
              <button onClick={resetNewModal} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            {analyzing && (
              <p className="text-xs text-brand-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 animate-pulse" /> Analizando factura…
              </p>
            )}
            {aiExtracted && !analyzing && (
              <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 space-y-1">
                <p className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Datos extraídos con IA — revisa antes de crear
                </p>
                {typeof aiExtracted.confidence === 'number' && (
                  <p className="text-muted-foreground">
                    Confianza: {Math.round(aiExtracted.confidence * (aiExtracted.confidence <= 1 ? 100 : 1))}%
                  </p>
                )}
                {typeof aiExtracted.vat === 'number' && (
                  <p className="text-muted-foreground">IVA detectado: {formatCurrency(aiExtracted.vat)}</p>
                )}
              </div>
            )}
            <input
              value={ne.concept}
              onChange={(e) => setNe({ ...ne, concept: e.target.value })}
              placeholder="Concepto"
              className={cls}
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={ne.category}
                onChange={(e) => setNe({ ...ne, category: e.target.value as Expense['category'] })}
                className={cls}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                value={ne.subcategory}
                onChange={(e) => setNe({ ...ne, subcategory: e.target.value })}
                placeholder="Subcategoría"
                className={cls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                step="0.01"
                min="0"
                value={ne.amount}
                onChange={(e) => setNe({ ...ne, amount: e.target.value })}
                placeholder="Importe (€)"
                className={cls}
              />
              <input
                type="date"
                value={ne.expense_date}
                onChange={(e) => setNe({ ...ne, expense_date: e.target.value })}
                className={cls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={ne.payment_method}
                onChange={(e) => setNe({ ...ne, payment_method: e.target.value })}
                className={cls}
              >
                {PAYMENT_METHODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select
                value={ne.status}
                onChange={(e) => setNe({ ...ne, status: e.target.value as Expense['status'] })}
                className={cls}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={ne.recurring}
                  onChange={(e) => setNe({ ...ne, recurring: e.target.checked })}
                  className="rounded border-border bg-muted"
                />
                Gasto recurrente
              </label>
              {ne.recurring && (
                <select
                  value={ne.frequency}
                  onChange={(e) => setNe({ ...ne, frequency: e.target.value as NonNullable<Expense['frequency']> })}
                  className="flex-1 bg-muted border border-border rounded-lg p-2 text-sm text-foreground"
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <input
              value={ne.counterparty}
              onChange={(e) => setNe({ ...ne, counterparty: e.target.value })}
              placeholder="Proveedor / contraparte"
              className={cls}
            />
            <select value={ne.person_id} onChange={(e) => setNe({ ...ne, person_id: e.target.value })} className={cls}>
              <option value="">— persona (opcional) —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name}
                </option>
              ))}
            </select>
            <textarea
              value={ne.notes}
              onChange={(e) => setNe({ ...ne, notes: e.target.value })}
              rows={2}
              placeholder="Notas"
              className={cls}
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={resetNewModal} className="px-3 py-2 text-sm text-muted-foreground">
                Cancelar
              </button>
              <button onClick={create} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg">
                Crear
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeEdit}>
          <div
            className="bg-card border border-border rounded-xl p-5 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Editar gasto</h3>
              <button onClick={closeEdit} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              value={ee.concept}
              onChange={(e) => setEe({ ...ee, concept: e.target.value })}
              placeholder="Concepto"
              className={cls}
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                value={ee.category}
                onChange={(e) => setEe({ ...ee, category: e.target.value as Expense['category'] })}
                className={cls}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <input
                value={ee.subcategory}
                onChange={(e) => setEe({ ...ee, subcategory: e.target.value })}
                placeholder="Subcategoría"
                className={cls}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                step="0.01"
                min="0"
                value={ee.amount}
                onChange={(e) => setEe({ ...ee, amount: e.target.value })}
                placeholder="Importe (€)"
                className={cls}
              />
              <input
                type="date"
                value={ee.expense_date}
                onChange={(e) => setEe({ ...ee, expense_date: e.target.value })}
                className={cls}
              />
            </div>
            <select
              value={ee.status}
              onChange={(e) => setEe({ ...ee, status: e.target.value as Expense['status'] })}
              className={cls}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <input
              value={ee.counterparty}
              onChange={(e) => setEe({ ...ee, counterparty: e.target.value })}
              placeholder="Proveedor / contraparte"
              className={cls}
            />
            <textarea
              value={ee.notes}
              onChange={(e) => setEe({ ...ee, notes: e.target.value })}
              rows={2}
              placeholder="Notas"
              className={cls}
            />
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={closeEdit} className="px-3 py-2 text-sm text-muted-foreground">
                Cancelar
              </button>
              <button onClick={saveEdit} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg">
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const cls =
  'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500'
