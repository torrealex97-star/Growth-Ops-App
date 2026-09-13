'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleDashed,
  Loader2,
  Plus,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { normalizeSlug } from '@/lib/tenants/blueprint'

type Step = { id: string; label: string; automatic: boolean; reason?: string }
type Readiness = {
  id: string
  slug: string
  name: string
  status: string
  createdAt: string
  brandName: string | null
  counts: { miembros: number; productos: number; planes: number; integraciones: number }
  members: Member[]
}
type Member = { userId: string; email: string | null; fullName: string | null; role: string }
type Payload = {
  steps: Step[]
  assignableRoles: string[]
  yourUserId: string
  yourTenantId: string
  tenants: Readiness[]
}

const ACCENTS = [
  { key: 'brand', label: 'Verde (por defecto)' },
  { key: 'pink', label: 'Rosa' },
] as const

export default function SubcuentasPage() {
  const tenant = useTenant()
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [accent, setAccent] = useState<'brand' | 'pink'>('brand')
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string; pendiente?: Step[] } | null>(null)
  // Estado de las operaciones sobre subcuentas ya existentes, por subcuenta.
  const [working, setWorking] = useState<string | null>(null)
  const [opResult, setOpResult] = useState<{ tenantId: string; ok: boolean; text: string } | null>(null)
  const [invite, setInvite] = useState<Record<string, { email: string; role: string }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/subcuentas`)
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || 'No se pudieron leer las subcuentas')
        setData(null)
        return
      }
      setData(j as Payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => {
    void load()
  }, [load])

  // El slug se enseña ANTES de crear: es la URL de esa subcuenta para siempre, así que el usuario
  // tiene que ver exactamente qué se va a guardar en vez de descubrirlo después.
  const slugPreview = useMemo(() => normalizeSlug(slug || name), [slug, name])

  async function create() {
    setCreating(true)
    setResult(null)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/subcuentas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug: slug || name, accent }),
      })
      const j = await r.json()
      if (!r.ok || j.ok === false) {
        setResult({ ok: false, text: j.mensaje || j.error || 'No se pudo crear la subcuenta' })
        return
      }
      setResult({
        ok: true,
        text: `Subcuenta "${j.tenant.name}" creada en /${j.tenant.slug}. Ya tienes acceso.`,
        pendiente: j.pendiente,
      })
      setName('')
      setSlug('')
      await load()
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Error de conexión' })
    } finally {
      setCreating(false)
    }
  }

  async function patch(tenantId: string, body: Record<string, unknown>, exito: string) {
    setWorking(tenantId)
    setOpResult(null)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/settings/subcuentas`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, tenantId }),
      })
      const j = await r.json()
      if (!r.ok || j.ok === false) {
        setOpResult({ tenantId, ok: false, text: j.mensaje || j.error || 'No se pudo aplicar el cambio' })
        return
      }
      setOpResult({ tenantId, ok: true, text: exito })
      await load()
    } catch (e) {
      setOpResult({ tenantId, ok: false, text: e instanceof Error ? e.message : 'Error de conexión' })
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/${tenant}/settings`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a Configuración
        </Link>
        <h1 className="text-foreground text-2xl font-bold">Subcuentas</h1>
        <p className="text-muted-foreground text-sm">
          Alta de subcuentas y estado de cada una. Una subcuenta nueva nace vacía y aislada: no se crean productos,
          planes ni datos de ejemplo, porque de esas tablas salen la facturación y las comisiones.
        </p>
      </div>

      <section className="border-border bg-card space-y-4 rounded-xl border p-4">
        <h2 className="text-foreground flex items-center gap-2 text-sm font-semibold">
          <Plus className="h-4 w-4" /> Crear subcuenta
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-muted-foreground text-xs">
            Nombre visible
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Women Digital Closer"
              className="border-border bg-background/60 text-foreground mt-1 block w-full rounded-lg border px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-muted-foreground text-xs">
            Identificador de URL (opcional)
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="se deriva del nombre"
              className="border-border bg-background/60 text-foreground mt-1 block w-full rounded-lg border px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-muted-foreground text-xs">
            Color de marca
            <select
              value={accent}
              onChange={(e) => setAccent(e.target.value as 'brand' | 'pink')}
              className="border-border bg-background/60 text-foreground mt-1 block w-full rounded-lg border px-2 py-1.5 text-sm"
            >
              {ACCENTS.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-muted-foreground text-xs">
          URL de la subcuenta: <code className="text-foreground">/{slugPreview || '…'}</code>. No se puede cambiar
          después sin romper los enlaces que ya estén repartidos.
        </p>
        <button
          onClick={() => void create()}
          disabled={creating || slugPreview.length < 3 || !name.trim()}
          className="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Crear subcuenta
        </button>

        {result ? (
          <div
            className={`space-y-2 rounded-lg border p-3 text-sm ${
              result.ok
                ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
                : 'border-red-500/30 bg-red-500/5 text-red-400'
            }`}
          >
            <p className="flex items-start gap-2">
              {result.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              {result.text}
            </p>
            {result.pendiente && result.pendiente.length > 0 ? (
              <div className="text-muted-foreground space-y-1">
                <p className="text-foreground text-xs font-medium">Lo que queda por hacer a mano:</p>
                {result.pendiente.map((step) => (
                  <p key={step.id} className="flex items-start gap-2 text-xs">
                    <CircleDashed className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>
                      {step.label}
                      {step.reason ? <span className="opacity-70"> — {step.reason}</span> : null}
                    </span>
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando subcuentas…
        </div>
      ) : error ? (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : !data ? null : (
        <div className="space-y-3">
          {data.tenants.map((t) => (
            <article key={t.id} className="border-border bg-card rounded-xl border p-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-foreground flex items-center gap-2 text-sm font-medium">
                  <Building2 className="h-4 w-4 opacity-70" />
                  {t.brandName || t.name}
                  <code className="text-muted-foreground font-normal">/{t.slug}</code>
                  {t.status !== 'active' ? <span className="text-amber-400">· {t.status}</span> : null}
                </div>
                <Link href={`/${t.slug}/settings`} className="text-muted-foreground hover:text-foreground text-xs">
                  Abrir configuración →
                </Link>
              </header>
              <dl className="text-muted-foreground mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {(
                  [
                    ['Miembros', t.counts.miembros],
                    ['Productos', t.counts.productos],
                    ['Planes de pago', t.counts.planes],
                    ['Integraciones', t.counts.integraciones],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd className={value === 0 ? 'text-amber-400' : 'text-foreground'}>{value}</dd>
                  </div>
                ))}
              </dl>
              {t.counts.productos === 0 || t.counts.planes === 0 ? (
                <p className="mt-2 text-xs text-amber-400">
                  Sin producto o sin plan de pago no se puede registrar una venta en esta subcuenta.
                </p>
              ) : null}

              <div className="border-border mt-3 space-y-3 border-t pt-3">
                <div className="space-y-1">
                  {t.members.map((m) => (
                    <div key={m.userId} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-foreground">{m.fullName || m.email || m.userId}</span>
                      <span className="text-muted-foreground">{m.role}</span>
                      {m.role === 'super_admin' ? (
                        <span className="text-muted-foreground opacity-70">(plataforma)</span>
                      ) : null}
                      <button
                        onClick={() =>
                          void patch(t.id, { action: 'quitar_acceso', userId: m.userId }, 'Acceso quitado.')
                        }
                        disabled={working === t.id || m.userId === data.yourUserId}
                        title={m.userId === data.yourUserId ? 'No puedes quitarte a ti mismo' : 'Quitar acceso'}
                        className="text-muted-foreground hover:text-red-400 disabled:opacity-40"
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={invite[t.id]?.email ?? ''}
                    onChange={(e) =>
                      setInvite((p) => ({ ...p, [t.id]: { email: e.target.value, role: p[t.id]?.role ?? 'member' } }))
                    }
                    placeholder="email de alguien que ya existe"
                    className="border-border bg-background/60 text-foreground rounded-lg border px-2 py-1 text-xs"
                  />
                  <select
                    value={invite[t.id]?.role ?? 'member'}
                    onChange={(e) =>
                      setInvite((p) => ({ ...p, [t.id]: { email: p[t.id]?.email ?? '', role: e.target.value } }))
                    }
                    className="border-border bg-background/60 text-foreground rounded-lg border px-2 py-1 text-xs"
                  >
                    {data.assignableRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() =>
                      void patch(
                        t.id,
                        {
                          action: 'dar_acceso',
                          email: invite[t.id]?.email ?? '',
                          role: invite[t.id]?.role ?? 'member',
                        },
                        'Acceso dado.'
                      )
                    }
                    disabled={working === t.id || !(invite[t.id]?.email ?? '').trim()}
                    className="border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs disabled:opacity-50"
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Dar acceso
                  </button>
                  {t.status === 'active' ? (
                    <button
                      onClick={() => void patch(t.id, { action: 'suspender' }, 'Subcuenta suspendida.')}
                      disabled={working === t.id || t.id === data.yourTenantId}
                      title={
                        t.id === data.yourTenantId
                          ? 'No puedes suspender la subcuenta desde la que administras'
                          : 'Suspender: nadie podrá entrar, sin borrar datos'
                      }
                      className="border-border text-muted-foreground hover:text-amber-400 ml-auto rounded-lg border px-2 py-1 text-xs disabled:opacity-40"
                    >
                      Suspender
                    </button>
                  ) : (
                    <button
                      onClick={() => void patch(t.id, { action: 'reactivar' }, 'Subcuenta reactivada.')}
                      disabled={working === t.id}
                      className="border-border text-muted-foreground hover:text-emerald-400 ml-auto rounded-lg border px-2 py-1 text-xs disabled:opacity-50"
                    >
                      Reactivar
                    </button>
                  )}
                </div>

                <p className="text-muted-foreground text-xs">
                  Dar acceso requiere que la persona ya exista en la plataforma: aquí no se crean cuentas. Y el rol
                  <code className="mx-1">super_admin</code> no está en la lista a propósito — es de plataforma, no de
                  subcuenta, y daría acceso también a las demás.
                </p>

                {opResult?.tenantId === t.id ? (
                  <p className={`text-xs ${opResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>{opResult.text}</p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
