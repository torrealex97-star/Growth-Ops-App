'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { formatNumber } from '@/lib/utils'

type Tier = { label: string | null; min_cash: number; max_cash: number | null; percent: number }
type Terms = {
  fixed_salary: number | null
  commissions: Tier[]
  affiliate_percent: number | null
  role_label: string | null
  extra_notes: string | null
}
type SignerField = { key: string; label: string; required: boolean }
type ContractData = {
  id: string
  title: string
  body: string
  terms: Terms
  status: 'pendiente' | 'enviado' | 'firmado'
  memberName: string | null
  company: { name: string; representative: string | null; cif: string | null; address: string | null }
  signerFields: SignerField[]
  signerPrefill: Record<string, string | null>
  signerName: string | null
  signedAt: string | null
  signedPdfUrl: string | null
}

const eur = (n: number) => formatNumber(n)
const tierText = (t: Tier) =>
  `${t.max_cash != null ? `${eur(t.min_cash)} – ${eur(t.max_cash)} €` : `${eur(t.min_cash)} €+`}${
    t.label ? ` (${t.label})` : ''
  } → ${t.percent}%`

// Sustitución en vivo de las variables del firmante para la vista previa.
function preview(body: string | null | undefined, sd: Record<string, string>): string {
  // Un contrato sin snapshot (p. ej. creado solo con PDF adjuntado) no debe romper la
  // página pública de firma: se muestra sin cuerpo en vez de fallar con un 500 opaco.
  if (!body) return ''
  const dir = [sd.address, sd.postal_code, sd.city].filter(Boolean).join(', ')
  const map: Record<string, string> = {
    dni: sd.dni || '__________',
    direccion: dir || '__________',
    direccion_calle: sd.address || '__________',
    codigo_postal: sd.postal_code || '__________',
    ciudad: sd.city || '__________',
    telefono: sd.phone || '__________',
  }
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (k in map ? map[k] : m))
}

export default function FirmarPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ContractData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [sd, setSd] = useState<Record<string, string>>({})
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/public-contracts/sign/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error)
        else {
          // Un contrato sin snapshot ni condiciones (PDF externo) no debe romper la página:
          // se normalizan los campos opcionales para renderizar sin asumir presencia.
          setData({ ...d, body: d.body ?? '', terms: d.terms ?? {} })
          setName(d.signerName || d.memberName || '')
          const pf = d.signerPrefill || {}
          setSd(Object.fromEntries(Object.entries(pf).map(([k, v]) => [k, (v as string) ?? ''])))
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
    const res = await fetch(`/api/public-contracts/sign/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signerName: name, consent, signerData: sd }),
    })
    const d = await res.json()
    setSubmitting(false)
    if (!res.ok) {
      setError(d.error || 'No se pudo firmar')
      return
    }
    setSignedUrl(d.signedPdfUrl)
  }

  if (loading)
    return <div className="min-h-screen grid place-items-center bg-zinc-100 text-zinc-500">Cargando contrato…</div>
  if (error && !data)
    return <div className="min-h-screen grid place-items-center bg-zinc-100 text-red-600 px-6 text-center">{error}</div>
  if (!data) return null

  const done = !!signedUrl || data.status === 'firmado'
  const missingRequired = data.signerFields.filter((f) => f.required && !sd[f.key]?.trim()).map((f) => f.label)
  const canSign = !!name.trim() && consent && missingRequired.length === 0

  return (
    <div className="min-h-screen bg-zinc-100 py-10 px-4">
      <div className="mx-auto max-w-2xl">
        <div className="bg-white rounded-xl shadow-sm border border-zinc-200 p-8 md:p-10">
          <div className="flex items-center justify-between border-b border-zinc-200 pb-4 mb-6">
            <div>
              <span className="text-lg font-bold text-zinc-900">{data.company.name}</span>
              {(data.company.cif || data.company.address) && (
                <p className="text-[11px] text-zinc-400">
                  {[data.company.cif && `CIF ${data.company.cif}`, data.company.address].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
            <span className="text-xs text-zinc-400">Contrato · firma electrónica</span>
          </div>

          <h1 className="text-xl font-bold text-zinc-900 mb-6">{data.title}</h1>

          <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-zinc-700">
            {done ? data.body : preview(data.body, sd)}
          </div>

          <div className="mt-8 rounded-lg bg-zinc-50 border border-zinc-200 p-5">
            <h2 className="text-sm font-bold text-zinc-900 mb-3">CONDICIONES ECONÓMICAS ACORDADAS</h2>
            <p className="text-sm text-zinc-700">
              <span className="font-medium">Retribución fija:</span>{' '}
              {data.terms.fixed_salary != null ? `${eur(data.terms.fixed_salary)} €/mes` : 'Sin retribución fija'}
            </p>
            {data.terms.commissions?.length > 0 ? (
              <div className="mt-2 text-sm text-zinc-700">
                <span className="font-medium">Comisiones (sobre cash collected):</span>
                <ul className="mt-1 space-y-0.5 list-disc list-inside text-zinc-600">
                  {data.terms.commissions.map((t, i) => (
                    <li key={i}>{tierText(t)}</li>
                  ))}
                </ul>
              </div>
            ) : data.terms.affiliate_percent != null ? (
              <p className="mt-2 text-sm text-zinc-700">
                <span className="font-medium">Comisión de afiliado:</span> {data.terms.affiliate_percent}%
              </p>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">Sin comisiones variables asociadas.</p>
            )}
            {data.terms.extra_notes && (
              <p className="mt-2 text-sm text-zinc-600">
                <span className="font-medium">Notas:</span> {data.terms.extra_notes}
              </p>
            )}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="font-semibold text-zinc-900">LA EMPRESA</p>
              <div className="mt-6 border-t border-zinc-300 pt-1 text-zinc-600">
                <p>Firmado digitalmente por {data.company.name}</p>
                <p className="text-xs text-zinc-500">{data.company.representative || data.company.name}</p>
              </div>
            </div>
            <div>
              <p className="font-semibold text-zinc-900">EL COLABORADOR</p>
              <div className="mt-6 border-t border-zinc-300 pt-1 text-zinc-600">
                <p>{done ? data.signerName || name : name || '—'}</p>
                <p className="text-xs text-zinc-500">{done ? 'Firmado electrónicamente' : 'Pendiente de firma'}</p>
              </div>
            </div>
          </div>
        </div>

        {done ? (
          <div className="mt-6 bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
            <p className="text-emerald-800 font-medium">✓ Contrato firmado correctamente</p>
            {signedUrl && (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="inline-block mt-3 text-sm font-medium text-emerald-700 underline"
              >
                Descargar PDF firmado
              </a>
            )}
          </div>
        ) : (
          <div className="mt-6 bg-white border border-zinc-200 rounded-xl p-6 shadow-sm">
            <h3 className="font-semibold text-zinc-900 mb-4">Completa tus datos y firma</h3>
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

            <label className="block text-sm text-zinc-600 mb-1">Nombre y apellidos completos</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400 mb-4"
              placeholder="Escribe tu nombre completo"
            />

            <div className="grid grid-cols-2 gap-3">
              {data.signerFields.map((f) => (
                <div key={f.key} className={f.key === 'address' ? 'col-span-2' : ''}>
                  <label className="block text-sm text-zinc-600 mb-1">
                    {f.label}
                    {f.required && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    value={sd[f.key] ?? ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400"
                  />
                </div>
              ))}
            </div>

            <label className="flex items-start gap-2 mt-4 text-sm text-zinc-600 cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 accent-emerald-600"
              />
              <span>
                He leído y acepto las condiciones del presente contrato y consiento firmarlo electrónicamente.
              </span>
            </label>

            {missingRequired.length > 0 && (
              <p className="mt-3 text-xs text-amber-600">Faltan por completar: {missingRequired.join(', ')}</p>
            )}

            <button
              onClick={sign}
              disabled={submitting || !canSign}
              className="mt-5 w-full rounded-md bg-zinc-900 text-white py-2.5 text-sm font-medium disabled:opacity-40 hover:bg-zinc-800 transition-colors"
            >
              {submitting ? 'Firmando…' : 'Firmar y aceptar'}
            </button>
            <p className="mt-3 text-xs text-zinc-400 text-center">
              Firma electrónica simple (eIDAS). Se registrarán fecha, IP y un hash del documento como evidencia.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
