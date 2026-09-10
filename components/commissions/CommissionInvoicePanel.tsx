"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { FileText, Upload, Loader2, CheckCircle2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

type SimpleMember = { id: string; full_name: string }

type CommissionInvoice = {
  id: string
  user_id: string
  period_month: string
  invoice_url: string | null
  amount: number | null
  status: string
  created_at: string
}

// Primer día del mes en formato YYYY-MM-DD.
function monthStart(year: number, monthIdx0: number): string {
  const m = String(monthIdx0 + 1).padStart(2, '0')
  return `${year}-${m}-01`
}

function monthLabel(period: string): string {
  const d = new Date(period)
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}

// Últimos 6 meses (incluido el actual) como opciones de periodo.
function recentMonths(): { value: string; label: string }[] {
  const now = new Date()
  const out: { value: string; label: string }[] = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = monthStart(d.getFullYear(), d.getMonth())
    out.push({ value, label: monthLabel(value) })
  }
  return out
}

export function CommissionInvoicePanel({
  currentUserId,
  currentUserRole,
  members,
}: {
  currentUserId: string
  currentUserRole: string
  members: SimpleMember[]
}) {
  const isAdmin = ['admin', 'director'].includes(currentUserRole)
  const months = useMemo(() => recentMonths(), [])
  // Por defecto, el mes anterior (el que se cierra el día 15).
  const defaultMonth = months[1]?.value ?? months[0]?.value ?? ''

  const [invoices, setInvoices] = useState<CommissionInvoice[]>([])
  // null = aún no comprobado; false = la tabla no existe todavía (migración v35 pendiente).
  const [available, setAvailable] = useState<boolean | null>(null)
  const [period, setPeriod] = useState<string>(defaultMonth)
  const [amount, setAmount] = useState<string>('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const memberName = (id: string) => members.find((m) => m.id === id)?.full_name ?? '—'

  const fetchInvoices = async () => {
    const supabase = createClient()
    // RLS: el comercial solo recibe las suyas; admin/director las de todos.
    const { data, error } = await supabase
      .from('commission_invoices')
      .select('*')
      .order('period_month', { ascending: false })
    if (error) {
      // Tabla inexistente (migración v35 pendiente) → ocultamos el panel.
      setAvailable(false)
      return
    }
    setAvailable(true)
    setInvoices((data as CommissionInvoice[]) ?? [])
  }

  useEffect(() => {
    fetchInvoices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const myInvoiceForPeriod = invoices.find(
    (inv) => inv.user_id === currentUserId && inv.period_month.slice(0, 7) === period.slice(0, 7)
  )

  const handleUpload = async (file: File) => {
    if (!file) return
    setUploading(true)
    const supabase = createClient()
    try {
      const ext = file.name.split('.').pop() || 'pdf'
      const stamp = `${Date.now()}`
      const path = `comisiones/${currentUserId}/${period.slice(0, 7)}-${stamp}.${ext}`
      const { error: upErr } = await supabase.storage.from('facturas').upload(path, file, { upsert: true })
      if (upErr) {
        toast.error('No se pudo subir la factura', { description: upErr.message })
        return
      }
      const { data: pub } = supabase.storage.from('facturas').getPublicUrl(path)
      const { error: dbErr } = await supabase
        .from('commission_invoices')
        .upsert(
          {
            user_id: currentUserId,
            period_month: period,
            invoice_url: pub.publicUrl,
            amount: amount.trim() ? parseFloat(amount) : null,
            status: 'recibida',
          },
          { onConflict: 'user_id,period_month' }
        )
      if (dbErr) {
        toast.error('No se pudo registrar la factura', { description: dbErr.message })
        return
      }
      toast.success('Factura enviada al departamento financiero')
      setAmount('')
      if (fileRef.current) fileRef.current.value = ''
      fetchInvoices()
    } finally {
      setUploading(false)
    }
  }

  const togglePaid = async (inv: CommissionInvoice) => {
    const supabase = createClient()
    const next = inv.status === 'pagada' ? 'recibida' : 'pagada'
    const { error } = await supabase.from('commission_invoices').update({ status: next }).eq('id', inv.id)
    if (error) {
      toast.error('No se pudo actualizar', { description: error.message })
      return
    }
    fetchInvoices()
  }

  if (available === false) return null

  return (
    <div className="space-y-4">
      {/* Panel del comercial: subir la factura del mes */}
      <div className="rounded-xl border border-border bg-card/50 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-brand-400" />
          <h3 className="text-sm font-semibold text-foreground">Mi factura de comisiones</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Adjunta tu factura del mes cerrado. Solo la ve el departamento financiero; el resto del equipo no.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Mes facturado</Label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger className="bg-muted border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Importe (€) — opcional</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="bg-muted border-border"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-xs">Archivo (PDF/imagen)</Label>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="w-full"
            >
              {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Subiendo…</> : <><Upload className="w-4 h-4 mr-2" />Adjuntar factura</>}
            </Button>
          </div>
        </div>

        {myInvoiceForPeriod && (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            Factura de {monthLabel(myInvoiceForPeriod.period_month)} enviada
            {myInvoiceForPeriod.status === 'pagada' && ' · pagada'}
            {myInvoiceForPeriod.invoice_url && (
              <a href={myInvoiceForPeriod.invoice_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300 ml-2">
                Ver <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </div>

      {/* Panel admin/director: facturas de todo el equipo */}
      {isAdmin && (
        <div className="rounded-xl border border-border bg-card/50 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Facturas de comisiones del equipo</h3>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay facturas subidas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-3 font-medium">Miembro</th>
                    <th className="py-2 pr-3 font-medium">Mes</th>
                    <th className="py-2 pr-3 font-medium">Importe</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                    <th className="py-2 pr-3 font-medium">Factura</th>
                    <th className="py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 text-foreground">{memberName(inv.user_id)}</td>
                      <td className="py-2 pr-3 text-foreground">{monthLabel(inv.period_month)}</td>
                      <td className="py-2 pr-3 text-foreground">{inv.amount != null ? `${inv.amount.toLocaleString('es-ES')} €` : '—'}</td>
                      <td className="py-2 pr-3">
                        <span className={inv.status === 'pagada' ? 'text-emerald-400' : 'text-amber-400'}>
                          {inv.status === 'pagada' ? 'Pagada' : 'Recibida'}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        {inv.invoice_url ? (
                          <a href={inv.invoice_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300">
                            Ver <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : '—'}
                      </td>
                      <td className="py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => togglePaid(inv)}>
                          {inv.status === 'pagada' ? 'Marcar recibida' : 'Marcar pagada'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
