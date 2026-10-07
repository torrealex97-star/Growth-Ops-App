'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, PencilLine, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrency, formatDate, formatPercent } from '@/lib/utils'
import {
  buildCollaboratorSaleReviews,
  type CollaboratorSaleReview,
  type CommissionDashboardRow,
} from '@/lib/commissions/dashboard'

export function CollaboratorSalesReview({
  rows,
  memberName,
  tenant,
  userId,
  onAdjusted,
}: {
  rows: CommissionDashboardRow[]
  memberName: string
  tenant: string
  userId: string
  onAdjusted: () => void
}) {
  const sales = useMemo(() => buildCollaboratorSaleReviews(rows), [rows])
  const [editing, setEditing] = useState<CollaboratorSaleReview | null>(null)
  const [percent, setPercent] = useState('0')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const open = (sale: CollaboratorSaleReview) => {
    setEditing(sale)
    setPercent(String(sale.percent))
    setReason('')
    setError('')
  }

  const save = async () => {
    if (!editing) return
    const targetPercent = Number(percent)
    if (!Number.isFinite(targetPercent) || targetPercent < 0 || targetPercent > 100 || reason.trim().length < 3) {
      setError('Indica un porcentaje entre 0 y 100 y un motivo de al menos 3 caracteres.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/${tenant}/evergreen/commissions/adjust-sale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId: editing.saleId, userId, targetPercent, reason: reason.trim() }),
      })
      const data = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        setError(data.error || 'No se pudo ajustar la comisión.')
        return
      }
      setEditing(null)
      onAdjusted()
    } catch {
      setError('Se perdió la conexión. Revisa tu red e inténtalo de nuevo; no se aplicó ningún cambio.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card/30" aria-labelledby="collaborator-sales-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4">
        <div>
          <h2 id="collaborator-sales-title" className="font-semibold text-foreground">
            Ventas atribuidas a {memberName}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Una fila por venta. Ajusta solo la comisión del colaborador; setter y closer no cambian.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          Todo cambio exige motivo y queda auditado
        </div>
      </div>

      {sales.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No hay ventas atribuidas con estos filtros.</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Cliente / venta</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Facturación</TableHead>
                  <TableHead className="text-right">Cash collected</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">%</TableHead>
                  <TableHead className="text-right">Generada</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                  <TableHead className="text-right">Pagada</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((sale) => (
                  <TableRow key={sale.saleId}>
                    <TableCell>
                      <p className="max-w-44 truncate font-medium text-foreground">{sale.contact}</p>
                      <Link
                        href={`/${tenant}/ventas/registro/${sale.saleId}`}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        {sale.saleId.slice(0, 8)} <ExternalLink className="inline h-3 w-3" />
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(sale.saleDate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(sale.booked)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(sale.collected)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatCurrency(sale.base)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatPercent(sale.percent)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatCurrency(sale.generated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-amber-400">
                      {formatCurrency(sale.outstanding)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-400">
                      {formatCurrency(sale.paid)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => open(sale)}
                        aria-label={`Ajustar comisión de ${sale.contact}`}
                      >
                        <PencilLine className="mr-1.5 h-3.5 w-3.5" /> Ajustar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="divide-y divide-border md:hidden">
            {sales.map((sale) => (
              <article key={sale.saleId} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{sale.contact}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(sale.saleDate)} · {formatPercent(sale.percent)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => open(sale)}>
                    Ajustar
                  </Button>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Facturación</dt>
                    <dd className="tabular-nums">{formatCurrency(sale.booked)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Cash collected</dt>
                    <dd className="tabular-nums">{formatCurrency(sale.collected)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Pendiente</dt>
                    <dd className="tabular-nums text-amber-400">{formatCurrency(sale.outstanding)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Pagada</dt>
                    <dd className="tabular-nums text-emerald-400">{formatCurrency(sale.paid)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </>
      )}

      <Dialog open={!!editing} onOpenChange={(isOpen) => !isOpen && !saving && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar comisión de esta venta</DialogTitle>
            <DialogDescription>
              Cambia el porcentaje o usa 0 % para que esta venta no comisione, conservando su atribución. Las cantidades
              ya pagadas se compensan con un ajuste, no se borran.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4 py-2">
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium text-foreground">{editing.contact}</p>
                <p className="mt-1 text-muted-foreground">
                  {formatCurrency(editing.booked)} facturados · {formatCurrency(editing.collected)} cobrados ·{' '}
                  {formatCurrency(editing.paid)} pagados
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="commission-percent">Porcentaje de comisión</Label>
                <Input
                  id="commission-percent"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={percent}
                  onChange={(event) => setPercent(event.target.value)}
                />
                <button
                  type="button"
                  className="text-xs text-destructive underline-offset-4 hover:underline"
                  onClick={() => setPercent('0')}
                >
                  Marcar esta venta como “No comisiona”
                </button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="commission-reason">Motivo del ajuste</Label>
                <Textarea
                  id="commission-reason"
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Ej.: venta anterior al inicio de la colaboración"
                />
              </div>
              {editing.hasLiquidated && (
                <p className="text-xs text-amber-400">
                  Esta venta tiene importes pagados. Se generará un ajuste compensatorio en el periodo actual.
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? 'Guardando…' : 'Aplicar ajuste'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
