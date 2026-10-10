'use client'

/**
 * Conexiones IA (MCP): clientes de ChatGPT/Claude autorizados por ESTE usuario y sus sesiones
 * activas, con revocación. El estado (activa/revocada/caducada) lo calcula el servidor — aquí
 * solo se pinta. Un access token caducado con refresh vivo sigue siendo una sesión activa:
 * el cliente puede renovarla solo.
 */
import { useCallback, useEffect, useState } from 'react'
import { Bot, Loader2, LogOut, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EstadoPanel } from '@/components/ui/carga/EstadoPanel'
import { pedir, esFalloVisible, type Fallo } from '@/lib/ui/pedir'

type ClienteConnectado = {
  client_id: string
  name: string
  owner_user_id: string | null
  redirect_uris: string[]
  created_at: string
}

type SesionMcp = {
  id: string
  client_id: string
  client_name: string | null
  scope: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  refresh_expires_at: string | null
  estado: 'activa' | 'revocada' | 'caducada'
}

const CORTES: Record<SesionMcp['estado'], { etiqueta: string; clase: string }> = {
  activa: { etiqueta: 'Activa', clase: 'bg-emerald-500/10 text-emerald-500' },
  revocada: { etiqueta: 'Revocada', clase: 'bg-red-500/10 text-red-500' },
  caducada: { etiqueta: 'Caducada', clase: 'bg-zinc-500/10 text-muted-foreground' },
}

function corto(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function McpConexionesPanel() {
  const [clientes, setClientes] = useState<ClienteConnectado[] | null>(null)
  const [sesiones, setSesiones] = useState<SesionMcp[] | null>(null)
  const [falloCarga, setFalloCarga] = useState<Fallo | null>(null)
  const [cargandoRevocar, setCargandoRevocar] = useState<string | null>(null)

  // fetch/pedir: mismo patrón de la casa — timeout y captura del fallo, sin bloques eternos.
  const load = useCallback(async () => {
    const res = await pedir<{ clientes: ClienteConnectado[]; sesiones: SesionMcp[] }>('/api/mcp/management')
    if (!res.ok) {
      if (!esFalloVisible(res)) return
      setFalloCarga(res)
      toast.error(res.mensaje)
      return
    }
    setClientes(res.data.clientes)
    setSesiones(res.data.sesiones)
    setFalloCarga(null)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function revocarSesion(b: SesionMcp) {
    if (!window.confirm(`¿Revocar la sesión de «${b.client_name ?? b.client_id}»? El cliente tendrá que reconectar.`)) return
    setCargandoRevocar(b.id)
    try {
      const r = await fetch('/api/mcp/management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revocar_sesion', tokenId: b.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo revocar la sesión')
        return
      }
      toast.success('Sesión revocada: el acceso del cliente queda inmediatamente invalidado')
      await load()
    } finally {
      setCargandoRevocar(null)
    }
  }

  async function revocarCliente(cliente: ClienteConnectado) {
    const n = (sesiones ?? []).filter((x) => x.client_id === cliente.client_id && x.estado === 'activa').length
    if (
      !window.confirm(
        `¿Revocar por completo "${cliente.name}"? Se cerrarán ${n} sesión${n === 1 ? '' : 'es'} activa(s) y el cliente desaparecerá de esta lista (tendrá que autorizarse de nuevo).`
      )
    )
      return
    setCargandoRevocar(cliente.client_id)
    try {
      const r = await fetch('/api/mcp/management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revocar_cliente', clientId: cliente.client_id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo revocar el acceso')
        return
      }
      toast.success(`Acceso de «${cliente.name}» revocado por completo`)
      await load()
    } finally {
      setCargandoRevocar(null)
    }
  }

  if (falloCarga) {
    return (
      <EstadoPanel
        estado={falloCarga.tipo === 'permiso' ? 'sin_permiso' : 'error'}
        que="las conexiones IA"
        mensajeError={falloCarga.mensaje}
        onReintentar={falloCarga.reintentable ? () => void load() : undefined}
      />
    )
  }

  if (clientes === null || sesiones === null) {
    return <EstadoPanel estado="cargando" que="las conexiones IA" filasSkeleton={2} />
  }

  const numActivas = sesiones.filter((s) => s.estado === 'activa').length

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/10">
          <Bot className="h-5 w-5 text-brand-400" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">Conexiones IA (MCP)</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Asistentes con acceso de solo lectura a los datos de tus subcuentas, autorizados por ti.
            {sesiones.length > 0 && <span> — {numActivas} sesión{numActivas === 1 ? ' activa' : 's activas'}.</span>}
          </p>
        </div>
      </div>

      {clientes.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed border-border p-6 text-center text-sm">
          Ningún asistente conectado todavía. Conecta ChatGPT o Claude con el endpoint
          <code className="bg-muted mx-1 rounded px-1.5 py-0.5 text-xs">/api/mcp</code> y aprueba el acceso aquí.
        </p>
      ) : (
        <div className="space-y-3">
          {clientes.map((cliente) => {
            const sesionesCliente = sesiones.filter((s) => s.client_id === cliente.client_id)
            const activas = sesionesCliente.filter((s) => s.estado === 'activa')
            return (
              <div key={cliente.client_id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden />
                      <p className="font-medium text-foreground">{cliente.name}</p>
                      <span className="text-muted-foreground text-xs">
                        desde {corto(cliente.created_at)}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 truncate text-xs">
                      {sesionesCliente.filter((s) => s.estado === 'activa').length} de{' '}
                      {sesionesCliente.length} sesión(es) activas
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={cargandoRevocar === cliente.client_id}
                    onClick={() => void revocarCliente(cliente)}
                  >
                    {cargandoRevocar === cliente.client_id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden />
                    )}
                    Revocar acceso completo
                  </Button>
                </div>

                {sesionesCliente.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {sesionesCliente.map((s) => {
                      const meta = CORTES[s.estado]
                      return (
                        <div
                          key={s.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm">
                              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${meta.clase}`}>
                                {meta.etiqueta}
                              </span>{' '}
                              <span className="text-muted-foreground">
                                creada {corto(s.created_at)} · expira {corto(s.expires_at)}
                              </span>
                            </p>
                          </div>
                          {s.estado === 'activa' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={cargandoRevocar === s.id}
                              onClick={() => void revocarSesion(s)}
                            >
                              {cargandoRevocar === s.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                              ) : (
                                <LogOut className="h-4 w-4" aria-hidden />
                              )}
                              Revocar sesión
                            </Button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => void load()} title="Recargar la lista">
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
