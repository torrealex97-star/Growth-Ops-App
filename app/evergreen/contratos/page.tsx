'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FileText, Plus, X, ExternalLink, Send, Webhook } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'
import { SearchBox, normalizeText } from '@/components/ui/search-box'

const STATUSES = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'enviado', label: 'Enviado' },
  { value: 'firmado', label: 'Firmado' },
] as const

const STATUS_STYLES: Record<string, string> = {
  pendiente: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  enviado: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  firmado: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
}

type Contact = { id: string; full_name: string }

type Contract = {
  id: string
  sale_id: string | null
  contact_id: string | null
  title: string
  url: string | null
  status: string
  signed_at: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  contacts: { full_name: string } | null
  sales: { id: string } | null
}

export default function ContratosPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [nc, setNc] = useState({ contact_id: '', title: '', url: '', status: 'pendiente' })

  const load = async () => {
    const supabase = createClient()
    const [cRes, contactsRes] = await Promise.all([
      supabase
        .from('contracts')
        .select('*, contacts(full_name), sales(id)')
        .order('created_at', { ascending: false }),
      supabase.from('contacts').select('id, full_name').order('full_name'),
    ])
    setContracts((cRes.data as Contract[]) || [])
    setContacts((contactsRes.data as Contact[]) || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const updateStatus = async (id: string, status: string) => {
    setContracts((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)))
    const supabase = createClient()
    const payload: Record<string, unknown> = { status }
    if (status === 'firmado') payload.signed_at = new Date().toISOString()
    const { error } = await supabase.from('contracts').update(payload).eq('id', id)
    if (error) {
      toast.error('No se pudo actualizar el estado')
      load()
      return
    }
    if (status === 'firmado') load()
  }

  const sendContract = async (id: string) => {
    setContracts((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'enviado' } : c)))
    const supabase = createClient()
    const { error } = await supabase.from('contracts').update({ status: 'enviado' }).eq('id', id)
    if (error) {
      toast.error('No se pudo marcar como enviado')
      load()
      return
    }
    toast.success('Contrato marcado como enviado', {
      description: 'Recuerda enviarlo desde tu herramienta de firma. Al firmarse, el webhook lo marcará automáticamente como "firmado".',
    })
  }

  const create = async () => {
    if (!nc.title.trim()) { toast.error('Pon un título'); return }
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('contracts').insert({
      contact_id: nc.contact_id || null,
      title: nc.title.trim(),
      url: nc.url || null,
      status: nc.status,
      created_by: user?.id,
    })
    if (error) { toast.error('Error al crear', { description: error.message }); return }
    toast.success('Contrato creado')
    setShowNew(false)
    setNc({ contact_id: '', title: '', url: '', status: 'pendiente' })
    load()
  }

  const total = contracts.length
  const firmados = contracts.filter((c) => c.status === 'firmado').length
  const pendientes = contracts.filter((c) => c.status === 'pendiente').length

  const nq = normalizeText(q.trim())
  const filtered = nq
    ? contracts.filter((c) =>
        normalizeText(c.contacts?.full_name || '').includes(nq) ||
        normalizeText(c.title || '').includes(nq) ||
        normalizeText(c.status || '').includes(nq)
      )
    : contracts

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-brand-400" /> Contratos
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Biblioteca de contratos de alumnos</p>
        </div>
        <div className="flex items-center gap-3">
          <SearchBox value={q} onChange={setQ} placeholder="Buscar por alumno, título o estado..." />
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-brand-600 text-white hover:bg-brand-500 whitespace-nowrap">
            <Plus className="w-4 h-4" /> Añadir contrato
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Total</p>
          <p className="text-2xl font-bold text-foreground">{total}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Firmados</p>
          <p className="text-2xl font-bold text-emerald-400">{firmados}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs text-muted-foreground mb-1">Pendientes</p>
          <p className="text-2xl font-bold text-amber-400">{pendientes}</p>
        </div>
      </div>

      <div className="bg-card/60 border border-border rounded-lg p-4 flex items-start gap-3">
        <Webhook className="w-5 h-5 text-brand-400 mt-0.5 shrink-0" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="text-foreground font-medium">Webhook de firma (configúralo en tu herramienta de e-sign / GHL)</p>
          <p>
            <span className="text-muted-foreground">URL: </span>
            <code className="text-brand-300 bg-muted px-1.5 py-0.5 rounded">
              https://tu-dominio.com/api/evergreen/webhooks/contract
            </code>
          </p>
          <p>
            Método <code className="text-foreground">POST</code> · cabecera{' '}
            <code className="text-foreground">x-ghl-secret</code> · body con{' '}
            <code className="text-foreground">contractId</code> o <code className="text-foreground">saleId</code> o{' '}
            <code className="text-foreground">email</code> + <code className="text-foreground">signedUrl</code>.
          </p>
          <p className="text-muted-foreground">Cuando la herramienta confirme la firma, el contrato pasará a &quot;Firmado&quot; automáticamente.</p>
        </div>
      </div>

      {loading ? (
        <div className="h-64 bg-card rounded-lg animate-pulse" />
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-10 text-center">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">{contracts.length === 0 ? 'Todavía no hay contratos.' : 'Ningún contrato coincide con la búsqueda.'}</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground text-xs uppercase tracking-wide">
                <th className="px-4 py-3">Alumno</th>
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Fecha firma</th>
                <th className="px-4 py-3">Enlace</th>
                <th className="px-4 py-3">Venta</th>
                <th className="px-4 py-3">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 text-foreground">{c.contacts?.full_name || '—'}</td>
                  <td className="px-4 py-3 text-foreground">{c.title}</td>
                  <td className="px-4 py-3">
                    <select
                      value={c.status}
                      onChange={(e) => updateStatus(c.id, e.target.value)}
                      className={`text-xs rounded border px-2 py-1 bg-card ${STATUS_STYLES[c.status] || 'border-border text-foreground'}`}
                    >
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.signed_at ? formatDate(c.signed_at) : '—'}</td>
                  <td className="px-4 py-3">
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer" className="text-brand-400 hover:text-brand-300 inline-flex items-center gap-1">
                        {c.status === 'firmado' ? 'Ver contrato firmado' : 'Ver'} <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.sale_id ? (
                      <Link href={`/evergreen/sales/${c.sale_id}`} className="text-brand-400 hover:text-brand-300 text-xs">
                        Ver venta
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.status === 'pendiente' ? (
                      <button
                        onClick={() => sendContract(c.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-sky-600/20 text-sky-300 border border-sky-600/30 hover:bg-sky-600/30"
                      >
                        <Send className="w-3.5 h-3.5" /> Enviar
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowNew(false)}>
          <div className="bg-card border border-border rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-foreground font-semibold">Nuevo contrato</h3>
              <button onClick={() => setShowNew(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            <select value={nc.contact_id} onChange={(e) => setNc({ ...nc, contact_id: e.target.value })} className={cls}>
              <option value="">— sin alumno —</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
            <input value={nc.title} onChange={(e) => setNc({ ...nc, title: e.target.value })} placeholder="Título del contrato" className={cls} />
            <input value={nc.url} onChange={(e) => setNc({ ...nc, url: e.target.value })} placeholder="Enlace (Drive, DocuSign, etc.)" className={cls} />
            <select value={nc.status} onChange={(e) => setNc({ ...nc, status: e.target.value })} className={cls}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setShowNew(false)} className="px-3 py-2 text-sm text-muted-foreground">Cancelar</button>
              <button onClick={create} className="px-3 py-2 text-sm bg-brand-600 text-white rounded-lg">Crear</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const cls = 'w-full bg-muted border border-border rounded-lg p-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-brand-500'
