"use client"

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { validateIdDocument } from '@/lib/contracts/id-validation'

type Condition = { label: string; value: string }
type SignerField = {
  key: string
  label: string
  required: boolean
  type?: 'text' | 'select'
  options?: { value: string; label: string }[]
  placeholder?: string
}
type ContractData = {
  id: string
  title: string
  body: string
  welcome: string
  conditions: Condition[]
  status: 'pendiente' | 'enviado' | 'firmado'
  studentName: string | null
  studentEmail: string | null
  company: { name: string; cif: string | null; address: string | null }
  signerFields: SignerField[]
  signerPrefill: Record<string, string | null>
  signerName: string | null
  signedAt: string | null
  signedPdfUrl: string | null
}

export default function FirmarAlumnoPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ContractData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [sd, setSd] = useState<Record<string, string>>({})
  const [consent, setConsent] = useState(false)
  const [showTerms, setShowTerms] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/evergreen/contracts/sign-student/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else {
          setData(d)
          setName(d.signerName || d.studentName || '')
          const pf = d.signerPrefill || {}
          const seeded = Object.fromEntries(Object.entries(pf).map(([k, v]) => [k, (v as string) ?? '']))
          if (!seeded.id_type) seeded.id_type = 'dni'
          setSd(seeded)
          if (d.status === 'firmado') setSignedUrl(d.signedPdfUrl ?? null)
        }
      })
      .catch(() => setError('No se pudo cargar el contrato'))
      .finally(() => setLoading(false))
  }, [token])

  const setField = (k: string, v: string) => setSd((prev) => ({ ...prev, [k]: v }))

  const sign = async () => {
    setSubmitting(true)
    setError(null)
    const res = await fetch(`/api/evergreen/contracts/sign-student/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signerName: name, consent, signerData: sd }),
    })
    const d = await res.json()
    setSubmitting(false)
    if (!res.ok) { setError(d.error || 'No se pudo firmar'); return }
    setSignedUrl(d.signedPdfUrl)
  }

  if (loading) return <div className="min-h-screen grid place-items-center bg-background text-muted-foreground">Cargando…</div>
  if (error && !data) return <div className="min-h-screen grid place-items-center bg-background text-red-400 px-6 text-center">{error}</div>
  if (!data) return null

  const done = !!signedUrl || data.status === 'firmado'

  // Valida campos requeridos, pero id_country es condicional (solo requerido si id_type === 'otro')
  const isInternational = sd.id_type === 'otro'
  const missingRequired = data.signerFields
    .filter((f) => {
      if (!f.required) return false
      if (f.key === 'id_country') return isInternational && !sd[f.key]?.trim()
      return !sd[f.key]?.trim()
    })
    .map((f) => f.label)

  const docError = validateIdDocument(sd.id_type, sd.dni ?? '')
  const canSign = !!name.trim() && consent && missingRequired.length === 0 && !docError

  if (done) {
    return (
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="mx-auto max-w-lg text-center">
          <div className="bg-gradient-to-b from-brand-600/20 to-zinc-900 border border-brand-500/30 rounded-2xl p-10">
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-2xl font-bold text-foreground mb-2">¡Ya eres un Winner!</h1>
            <p className="text-foreground">Contrato firmado correctamente. En breve recibirás tus accesos a la Academia por email.</p>
            {signedUrl && (
              <a href={signedUrl} target="_blank" rel="noopener noreferrer" download
                className="inline-block mt-6 text-sm font-medium text-brand-300 underline">
                Descargar mi contrato en PDF
              </a>
            )}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Firma electrónica simple (eIDAS) · {data.company.name}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="mx-auto max-w-lg">
        {/* Bienvenida */}
        <div className="bg-gradient-to-b from-brand-600/20 to-zinc-900 border border-brand-500/30 rounded-2xl p-8 text-center">
          <p className="text-xs uppercase tracking-widest text-brand-300 mb-3">{data.company.name}</p>
          <p className="text-lg font-semibold text-foreground leading-relaxed">{data.welcome}</p>
        </div>

        {/* Formulario */}
        <div className="mt-5 bg-card border border-border rounded-2xl p-6 shadow-sm">
          {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

          <label className="block text-sm text-muted-foreground mb-1">Nombre y apellidos</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 mb-4"
            placeholder="Tu nombre completo" />

          <div className="grid grid-cols-2 gap-3">
            {data.signerFields.map((f) => {
              // Oculta id_country si no es internacional
              if (f.key === 'id_country' && !isInternational) return null

              const showDocError = f.key === 'dni' && !!docError && !!sd.dni?.trim()
              const isRequired = f.key === 'id_country' ? isInternational : f.required
              return (
                <div key={f.key} className={['address', 'id_country'].includes(f.key) ? 'col-span-2' : ''}>
                  <label className="block text-sm text-muted-foreground mb-1">{f.label}{isRequired && <span className="text-red-400"> *</span>}</label>
                  {f.type === 'select' ? (
                    <select value={sd[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)}
                      className="w-full rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500">
                      {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input value={sd[f.key] ?? ''} onChange={(e) => setField(f.key, e.target.value)} placeholder={f.placeholder}
                      className={`w-full rounded-lg border bg-muted px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-brand-500 ${showDocError ? 'border-red-500/60' : 'border-border'}`} />
                  )}
                  {showDocError && <p className="mt-1 text-xs text-red-400">{docError}</p>}
                </div>
              )
            })}
          </div>

          {/* Resumen de condiciones */}
          <div className="mt-5 rounded-lg bg-muted/60 border border-border p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Tu programa</h2>
            <dl className="space-y-1">
              {data.conditions.map((c) => (
                <div key={c.label} className="flex justify-between text-sm">
                  <dt className="text-muted-foreground">{c.label}</dt>
                  <dd className="text-foreground font-medium text-right ml-4">{c.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Aceptación — "condiciones" es un desplegable con el contrato completo */}
          <label className="flex items-start gap-2.5 mt-5 text-sm text-foreground cursor-pointer">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 accent-brand-600 w-4 h-4" />
            <span>
              He leído y acepto las{' '}
              <button type="button" onClick={(e) => { e.preventDefault(); setShowTerms((v) => !v) }}
                className="text-brand-400 underline underline-offset-2 hover:text-brand-300">
                condiciones del contrato
              </button>{' '}
              y consiento firmarlo electrónicamente.
            </span>
          </label>

          {showTerms && (
            <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-border bg-background p-4">
              <p className="text-[13px] leading-relaxed text-foreground whitespace-pre-wrap">{data.body}</p>
            </div>
          )}

          {missingRequired.length > 0 && (
            <p className="mt-3 text-xs text-amber-400">Faltan por completar: {missingRequired.join(', ')}</p>
          )}

          <button onClick={sign} disabled={submitting || !canSign}
            className="mt-5 w-full rounded-lg bg-brand-600 text-white py-3 text-sm font-bold disabled:opacity-40 hover:bg-brand-500 transition-colors">
            {submitting ? 'Firmando…' : 'Aceptar y recibir mis accesos'}
          </button>
          <p className="mt-3 text-xs text-muted-foreground text-center">Firma electrónica simple (eIDAS). Se registran fecha, IP y un hash del documento como evidencia.</p>
        </div>
      </div>
    </div>
  )
}
