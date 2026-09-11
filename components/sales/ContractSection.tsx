'use client'

import { useEffect, useState, useCallback } from 'react'
import { FileText, Copy, Check, ExternalLink, Send, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { formatDateTime } from '@/lib/utils'
import { useTenant } from '@/lib/tenant-context'

type StudentContract = {
  id: string
  status: 'pendiente' | 'enviado' | 'firmado'
  signing_token: string | null
  signUrl: string
  read_at: string | null
  signed_at: string | null
  signed_pdf_url: string | null
  accesos_enviados_at: string | null
  accesos_abiertos_at: string | null
  onboarding_webhook_ok: boolean | null
  email_sent_at: string | null
  is_reservation: boolean
  contract_party: 'alumno' | 'tomador'
  // Tracking de onboarding (vive en la venta, lo devuelve el endpoint junto al contrato).
  onboarding_scheduled_at?: string | null
  onboarding_session_at?: string | null
  onboarding_date?: string | null
}

// Tiempo transcurrido legible entre dos instantes (para métricas de rapidez).
function elapsedLabel(fromIso?: string | null, toIso?: string | null): string | null {
  if (!fromIso || !toIso) return null
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  if (!isFinite(ms) || ms < 0) return null
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} días`
}

function TimingStat({ label, value, warn }: { label: string; value: string | null; warn?: boolean }) {
  if (!value) return null
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${warn ? 'border-amber-500/30 bg-amber-500/10' : 'border-border bg-muted/40'}`}
    >
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold ${warn ? 'text-amber-300' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}

// Pipeline de estados del contrato/onboarding para que el closer salga de la
// llamada sabiendo: enviado → leído → firmado → accesos enviados → (abiertos).
function StepDot({ done, label, at }: { done: boolean; label: string; at?: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2.5 h-2.5 rounded-full ${done ? 'bg-emerald-500' : 'bg-muted'}`} />
      <span className={`text-sm ${done ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
      {at && <span className="text-xs text-muted-foreground">· {formatDateTime(at)}</span>}
    </div>
  )
}

type Recipient = 'alumno' | 'tomador' | 'ambos'

export function ContractSection({ saleId }: { saleId: string }) {
  const tenant = useTenant()
  const [contract, setContract] = useState<StudentContract | null>(null)
  const [payerContract, setPayerContract] = useState<StudentContract | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hasDistinctPayer, setHasDistinctPayer] = useState(false)
  const [payerName, setPayerName] = useState<string | null>(null)
  const [recipient, setRecipient] = useState<Recipient>('alumno')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/contracts/student?saleId=${saleId}`)
      const d = await res.json().catch(() => ({}))
      setContract(d.contract ?? null)
      setPayerContract(d.payerContract ?? null)
      setHasDistinctPayer(!!d.hasDistinctPayer)
      setPayerName(d.payerName ?? null)
      if (d.recommendedRecipient) setRecipient(d.recommendedRecipient as Recipient)
    } finally {
      setLoading(false)
    }
  }, [saleId])

  useEffect(() => {
    load()
  }, [load])

  const generate = async (send: boolean) => {
    setBusy(true)
    const res = await fetch(`/api/${tenant}/evergreen/contracts/student`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saleId, send, recipient }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      toast.error('No se pudo generar el contrato', { description: d?.error })
      return
    }
    if (send) {
      toast.success(d.emailed ? 'Contrato enviado por email' : 'Contrato generado', {
        description: d.emailed
          ? undefined
          : 'Copia el enlace y pásaselo al alumno (email no configurado o sin correo).',
      })
    } else {
      toast.success('Contrato generado')
    }
    load()
  }

  const copyLink = async () => {
    if (!contract) return
    try {
      await navigator.clipboard.writeText(contract.signUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
      toast.success('Enlace de firma copiado')
    } catch {
      toast.error('No se pudo copiar; selecciónalo manualmente')
    }
  }

  if (loading) {
    return <div className="bg-card border border-border rounded-lg p-6 mt-4 h-24 animate-pulse" />
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 mt-4">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-semibold text-foreground">
            {contract?.is_reservation ? 'Contrato de reserva' : 'Contrato del alumno'}
          </h3>
        </div>
        {contract?.status === 'firmado' && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-full px-2 py-0.5">
            <ShieldCheck className="w-3.5 h-3.5" /> Firmado
          </span>
        )}
      </div>

      {hasDistinctPayer && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs text-amber-300 mb-2">
            El comprador es distinto del alumno{payerName ? ` (${payerName})` : ''}. ¿A quién se envía el contrato?
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['alumno', 'Solo alumno'],
                ['ambos', 'Alumno + pagador'],
                ['tomador', 'Solo pagador'],
              ] as [Recipient, string][]
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setRecipient(val)}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${recipient === val ? 'bg-brand-600 text-white border-brand-500' : 'bg-muted text-foreground border-border hover:bg-muted/70'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            En financiación debe firmar el pagador (queda obligado al pago). En full pay basta con el alumno y así
            evitas fricción con el pagador.
          </p>
        </div>
      )}

      {!contract ? (
        <div className="text-center py-4">
          <p className="text-sm text-muted-foreground mb-3">Aún no se ha generado el contrato para esta venta.</p>
          <button
            onClick={() => generate(true)}
            disabled={busy}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Generar y enviar contrato
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Pipeline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
            {contract.is_reservation ? (
              <>
                <StepDot
                  done={!!(contract.email_sent_at || contract.status !== 'pendiente')}
                  label="Contrato de reserva enviado"
                  at={contract.email_sent_at}
                />
                <StepDot done={!!contract.read_at} label="Reserva abierta por el alumno" at={contract.read_at} />
                <StepDot
                  done={contract.status === 'firmado'}
                  label="Contrato de reserva firmado"
                  at={contract.signed_at}
                />
              </>
            ) : (
              <>
                <StepDot
                  done={!!(contract.email_sent_at || contract.status !== 'pendiente')}
                  label="Contrato enviado"
                  at={contract.email_sent_at}
                />
                <StepDot done={!!contract.read_at} label="Contrato abierto por el alumno" at={contract.read_at} />
                <StepDot done={contract.status === 'firmado'} label="Contrato firmado" at={contract.signed_at} />
                <StepDot
                  done={!!contract.accesos_enviados_at}
                  label="Accesos enviados"
                  at={contract.accesos_enviados_at}
                />
                <StepDot
                  done={!!contract.accesos_abiertos_at}
                  label="Abrió la landing de accesos (click)"
                  at={contract.accesos_abiertos_at}
                />
                <StepDot
                  done={!!contract.onboarding_scheduled_at}
                  label={
                    contract.onboarding_session_at
                      ? `Onboarding agendado · sesión ${new Date(contract.onboarding_session_at).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                      : 'Onboarding agendado'
                  }
                  at={contract.onboarding_scheduled_at}
                />
                <StepDot done={!!contract.onboarding_date} label="Onboarding realizado" at={contract.onboarding_date} />
              </>
            )}
          </div>

          {/* Métricas de rapidez (objetivo: que el alumno firme y tenga accesos cuanto antes) */}
          {!contract.is_reservation && (contract.signed_at || contract.accesos_abiertos_at) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <TimingStat
                label="Tiempo hasta firma"
                value={elapsedLabel(contract.email_sent_at, contract.signed_at)}
                warn={!!contract.email_sent_at && !contract.signed_at}
              />
              <TimingStat
                label="Firma → accesos abiertos"
                value={elapsedLabel(contract.signed_at, contract.accesos_abiertos_at)}
              />
              <TimingStat
                label="Accesos → onboarding agendado"
                value={elapsedLabel(contract.accesos_enviados_at, contract.onboarding_scheduled_at)}
              />
            </div>
          )}

          {contract.is_reservation && (
            <p className="text-xs text-amber-400">
              Reserva: se envía solo el contrato de reserva. Los accesos NO se dan aquí — se envían al completar el pago
              y firmar el contrato definitivo.
            </p>
          )}

          {!contract.is_reservation && contract.status === 'firmado' && contract.accesos_enviados_at == null && (
            <p className="text-xs text-amber-400">
              Firmado, pero el webhook de accesos a GoHighLevel aún no está configurado (falta la URL). Da los accesos
              manualmente hasta que se conecte.
            </p>
          )}

          {/* Enlace cortafuegos */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Enlace de firma (cortafuegos)</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={contract.signUrl}
                className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-xs text-foreground font-mono truncate"
              />
              <button
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-brand-600 text-white hover:bg-brand-500 whitespace-nowrap"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Pégaselo al alumno por WhatsApp/Meet si no le llega el correo.
            </p>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap gap-2 pt-1">
            {contract.status !== 'firmado' && (
              <button
                onClick={() => generate(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-sky-600/20 text-sky-300 border border-sky-600/30 hover:bg-sky-600/30 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Reenviar por email
              </button>
            )}
            {contract.signed_pdf_url && (
              <a
                href={contract.signed_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-emerald-600/20 text-emerald-300 border border-emerald-600/30 hover:bg-emerald-600/30"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Descargar PDF firmado
              </a>
            )}
            <a
              href={contract.signUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-muted text-foreground border border-border hover:bg-muted"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Abrir contrato
            </a>
          </div>
        </div>
      )}

      {/* Contrato del TOMADOR (comprador distinto del alumno) */}
      {payerContract && (
        <div className="mt-5 pt-5 border-t border-border space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-400" />
            <h4 className="text-sm font-semibold text-foreground">Contrato del tomador (pagador)</h4>
            {payerContract.status === 'firmado' && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 rounded-full px-2 py-0.5">
                <ShieldCheck className="w-3.5 h-3.5" /> Firmado
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6">
            <StepDot
              done={!!(payerContract.email_sent_at || payerContract.status !== 'pendiente')}
              label="Contrato enviado al tomador"
              at={payerContract.email_sent_at}
            />
            <StepDot done={!!payerContract.read_at} label="Abierto por el tomador" at={payerContract.read_at} />
            <StepDot
              done={payerContract.status === 'firmado'}
              label="Firmado por el tomador"
              at={payerContract.signed_at}
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {payerContract.signed_pdf_url && (
              <a
                href={payerContract.signed_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-emerald-600/20 text-emerald-300 border border-emerald-600/30 hover:bg-emerald-600/30"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Descargar PDF firmado
              </a>
            )}
            <a
              href={payerContract.signUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-muted text-foreground border border-border hover:bg-muted"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Abrir contrato del tomador
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
