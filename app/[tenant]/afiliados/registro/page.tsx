'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, Loader2, CheckCircle2 } from 'lucide-react'
import type { AffiliateFormField } from '@/lib/types/database'
import { useTenant, useTenantBranding } from '@/lib/tenant-context'

type FormConfig = {
  program_name: string
  intro: string
  success_message: string
  fields: AffiliateFormField[]
  campaign: { name: string } | null
}

const inputType = (key: string) => {
  if (key === 'email') return 'email'
  if (key === 'phone') return 'tel'
  return 'text'
}

export default function RegistroAfiliadoPage() {
  const tenant = useTenant()
  const branding = useTenantBranding()
  const [config, setConfig] = useState<FormConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [values, setValues] = useState<Record<string, string>>({})
  const [company, setCompany] = useState('') // honeypot
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const [campaignSlug, setCampaignSlug] = useState('')

  useEffect(() => {
    // Enlace por campaña: /${tenant}/afiliados/registro?c=<slug>
    const slug = new URLSearchParams(window.location.search).get('c')?.trim() ?? ''
    setCampaignSlug(slug)
    const url = slug
      ? `/api/${tenant}/evergreen/afiliados/form-config?c=${encodeURIComponent(slug)}`
      : `/api/${tenant}/evergreen/afiliados/form-config`
    fetch(url)
      .then((r) => r.json())
      .then((data: FormConfig) => setConfig(data))
      .catch(() => setError('No se pudo cargar el formulario. Inténtalo más tarde.'))
      .finally(() => setLoading(false))
  }, [tenant])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((prev) => ({ ...prev, [key]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/afiliados/registro`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, company, campaign_slug: campaignSlug }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'No se pudo completar el registro.')
        setSubmitting(false)
        return
      }
      setDone(data.message || config?.success_message || '¡Listo!')
    } catch {
      setError('Error de conexión. Inténtalo de nuevo.')
      setSubmitting(false)
    }
  }

  return (
    <div className="dark min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-foreground" />
          </div>
          <span className="text-foreground font-semibold text-lg">{branding.name}</span>
        </div>

        {loading ? (
          <div className="h-72 bg-card border border-border rounded-xl animate-pulse" />
        ) : done ? (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-foreground mb-2">¡Registro completado!</h1>
            <p className="text-muted-foreground text-sm">{done}</p>
          </div>
        ) : (
          <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
            {config?.campaign && (
              <div className="mb-4 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-300">
                Te registras para la campaña <span className="font-semibold">{config.campaign.name}</span>
              </div>
            )}
            <h1 className="text-2xl font-bold text-foreground mb-1">{config?.program_name}</h1>
            {config?.intro && <p className="text-muted-foreground text-sm mb-6">{config.intro}</p>}

            <form onSubmit={handleSubmit} className="space-y-4">
              {(config?.fields ?? []).map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <label className="text-sm text-foreground">
                    {f.label} {f.required && <span className="text-brand-400">*</span>}
                  </label>
                  {f.key === 'motivation' ? (
                    <textarea
                      value={values[f.key] ?? ''}
                      onChange={set(f.key)}
                      required={f.required}
                      rows={3}
                      className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  ) : (
                    <input
                      type={inputType(f.key)}
                      value={values[f.key] ?? ''}
                      onChange={set(f.key)}
                      required={f.required}
                      className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  )}
                </div>
              ))}

              {/* Honeypot anti-spam: invisible para humanos */}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="hidden"
                aria-hidden="true"
              />

              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-foreground font-medium rounded-md px-4 py-2.5 text-sm flex items-center justify-center gap-2 transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Enviando...
                  </>
                ) : (
                  'Darme de alta como colaborador'
                )}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
