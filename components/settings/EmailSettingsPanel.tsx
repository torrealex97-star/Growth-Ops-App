'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Save, CheckCircle2, AlertTriangle, Send, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'
import { LABELS } from './email-labels'

type ProviderInfo = { connected: boolean; usingGlobalFallback: boolean; providerDomain: string | null }
type Settings = { from_name: string | null; from_email: string | null; reply_to_email: string | null }
type Message = {
  id: string
  template_key: string
  to_email: string
  subject: string
  status: string
  is_test: boolean
  error_message: string | null
  created_at: string
}

const STATUS_STYLE: Record<string, string> = {
  QUEUED: 'bg-muted text-muted-foreground',
  SENT: 'bg-blue-500/10 text-blue-400',
  DELIVERED: 'bg-emerald-500/10 text-emerald-400',
  OPENED: 'bg-violet-500/10 text-violet-400',
  CLICKED: 'bg-violet-500/10 text-violet-400',
  BOUNCED: 'bg-amber-500/10 text-amber-400',
  COMPLAINED: 'bg-rose-500/10 text-rose-400',
  FAILED: 'bg-rose-500/10 text-rose-400',
}
const STATUS_LABEL: Record<string, string> = {
  QUEUED: 'En cola',
  SENT: 'Enviado',
  DELIVERED: 'Entregado',
  OPENED: 'Abierto',
  CLICKED: 'Clic',
  BOUNCED: 'Rebotado',
  COMPLAINED: 'Spam',
  FAILED: 'Error',
}

export function EmailProviderBanner({ provider }: { provider: ProviderInfo | null }) {
  if (provider === null) return null
  if (!provider.connected) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-500/30 bg-amber-500/10">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="text-foreground font-medium">Resend no está configurado</p>
          <p className="text-muted-foreground mt-0.5">
            Para poder enviar emails conecta Resend desde Configuración › Integraciones.
          </p>
          <Link
            href="#integraciones"
            className="inline-flex items-center gap-1 mt-2 text-xs text-brand-400 hover:text-brand-300"
          >
            Ir a Integraciones <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/40 text-sm">
      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      <span className="text-foreground">Proveedor: Resend · Conectado</span>
      {provider.usingGlobalFallback && (
        <span className="text-amber-400 text-xs">· usando credencial global (configura la tuya en Integraciones)</span>
      )}
      {provider.providerDomain && (
        <span className="text-muted-foreground text-xs">· dominio: {provider.providerDomain}</span>
      )}
    </div>
  )
}

export function EmailSettingsPanel() {
  const tenant = useTenant()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [saving, setSaving] = useState(false)
  const [fromName, setFromName] = useState('')
  const [fromEmail, setFromEmail] = useState('')
  const [replyTo, setReplyTo] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/${tenant}/evergreen/settings/email`)
    const json = await res.json()
    if (res.ok) {
      setSettings(json.settings)
      setProvider(json.provider)
      setFromName(json.settings.from_name ?? '')
      setFromEmail(json.settings.from_email ?? '')
      setReplyTo(json.settings.reply_to_email ?? '')
    }
  }, [tenant])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/settings/email`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_name: fromName, from_email: fromEmail, reply_to_email: replyTo }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error al guardar')
      toast.success('Identidad de envío guardada')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <EmailProviderBanner provider={provider} />

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Nombre del remitente</label>
            <input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Acme Consulting"
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Email remitente</label>
            <input
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder={`hola@${provider?.providerDomain ?? 'tudominio.com'}`}
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Reply-To</label>
            <input
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="soporte@tudominio.com"
              className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          La firma se edita en Configuración › Datos de empresa. La API key de Resend se gestiona en Configuración ›
          Integraciones — aquí solo la identidad con la que se envía.
        </p>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar
        </button>
      </div>
    </div>
  )
}

export function EmailHistoryPanel() {
  const tenant = useTenant()
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [status, setStatus] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (to) params.set('to', to)
    const res = await fetch(`/api/${tenant}/evergreen/emails?${params}`)
    const json = await res.json()
    if (res.ok) setMessages(json.messages)
  }, [tenant, status, to])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="Filtrar por destinatario…"
          className="bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground flex-1 min-w-48"
        />
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Destinatario</th>
              <th className="px-4 py-3 font-medium">Plantilla</th>
              <th className="px-4 py-3 font-medium">Asunto</th>
              <th className="px-4 py-3 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(messages ?? []).map((m) => (
              <tr key={m.id} className="hover:bg-muted/40">
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                  {new Date(m.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                </td>
                <td className="px-4 py-3">
                  {m.to_email}
                  {m.is_test && <span className="ml-2 text-[10px] uppercase text-amber-400">prueba</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{LABELS[m.template_key] ?? m.template_key}</td>
                <td className="px-4 py-3 max-w-72 truncate">{m.subject}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${STATUS_STYLE[m.status] ?? 'bg-muted'}`}>
                    {STATUS_LABEL[m.status] ?? m.status}
                  </span>
                  {m.error_message && (
                    <span
                      className="block text-xs text-muted-foreground mt-1 max-w-56 truncate"
                      title={m.error_message}
                    >
                      {m.error_message}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {messages !== null && messages.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  Todavía no se ha enviado ningún email desde esta subcuenta.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {messages === null && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  )
}

export { Send }
