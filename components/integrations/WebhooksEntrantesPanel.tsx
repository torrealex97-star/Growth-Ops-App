'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Radio, Copy, CheckCircle2, XCircle, KeyRound, ShieldAlert, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import type { WebhookEntranteEstado, EstadoSecretInfo } from '@/lib/webhooks/entrantes'

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE «WEBHOOKS ENTRANTES» — la mitad receptora de las integraciones
// ─────────────────────────────────────────────────────────────────────────────
// Hasta ahora, dar de alta un webhook exigía buscar la URL en una guía, adivinar
// si el secret estaba bien y descubrir a posteriori que nada entraba. Aquí está
// todo junto: la URL exacta de esta subcuenta con botón de copiar, el estado
// REAL del secreto (con la pista de dónde vive el valor que se usa) y la fecha
// del último evento recibido CON SU EVIDENCIA — nunca derivada de las filas del
// negocio, que el pull del cron también escribe.
//
// «—» significa "nunca ha llegado ninguno". No es 0 ni un error: es la verdad
// que permitió demostrar forensemente que el webhook de GHL nunca entró.

const SECRET_META: Record<EstadoSecretInfo['estado'], { etiqueta: string; clase: string; icono: typeof KeyRound }> = {
  ok: { etiqueta: 'Configurado', clase: 'text-emerald-400', icono: CheckCircle2 },
  solo_entorno: { etiqueta: 'Solo en entorno', clase: 'text-amber-400', icono: KeyRound },
  sin_configurar: { etiqueta: 'Sin configurar', clase: 'text-red-400', icono: XCircle },
  no_descifrable: { etiqueta: 'No descifrable', clase: 'text-red-400', icono: ShieldAlert },
}

function haceCuanto(iso: string): string | null {
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms) || ms < 0) return null
  const min = Math.round(ms / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

function FilaWebhook({ w, tenant }: { w: WebhookEntranteEstado; tenant: string }) {
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}${w.path.replace('{tenant}', tenant)}`
  const meta = SECRET_META[w.secret.estado]
  const Icono = meta.icono
  const ultima = w.ultimoEvento ? haceCuanto(w.ultimoEvento.fecha) : null

  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{w.titulo}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{w.descripcion}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${meta.clase}`}>
          <Icono className="h-3.5 w-3.5" />
          {meta.etiqueta}
        </span>
      </div>

      {/* URL exacta de esta subcuenta, con copiar. Construir la URL a mano es donde se cuela la
          errata que luego cuesta una tarde — el mismo motivo que la guía de GHL la pinta montada. */}
      <div className="mt-3 flex items-center gap-2">
        <code className="bg-background/60 border-border flex-1 overflow-x-auto rounded border px-2 py-1.5 text-xs">
          {url}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard
              ?.writeText(url)
              .then(() => toast.success('Dirección copiada'))
              .catch(() => toast.error('No se pudo copiar: selecciónala y cópiala a mano'))
          }}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copiar
        </Button>
      </div>

      <div className="text-muted-foreground mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        <span>
          Método: <code className="text-foreground">{w.metodo}</code>
        </span>
        <span>
          Cabecera o firma: <code className="text-foreground">{w.auth.nombre}</code>
          {w.auth.tipo === 'firma' ? ' (firmada por el proveedor)' : ''}
        </span>
        <span>Eventos: {w.eventos.join(', ')}</span>
        <span className="flex items-center gap-1">
          <Radio className="h-3 w-3" aria-hidden />
          Último evento:{' '}
          {w.ultimoEvento ? (
            <span className="text-foreground">{ultima ?? new Date(w.ultimoEvento.fecha).toLocaleString('es-ES')}</span>
          ) : (
            <span className="text-foreground">— (nunca ha llegado ninguno)</span>
          )}
        </span>
      </div>
      {w.ultimoEvento ? (
        <p className="text-muted-foreground/70 mt-1 text-[11px]">Evidencia: {w.ultimoEvento.evidencia}</p>
      ) : null}
      {w.ultimoRechazo ? (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-400">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Último rechazo de firma:{' '}
          {haceCuanto(w.ultimoRechazo.fecha) ?? new Date(w.ultimoRechazo.fecha).toLocaleString('es-ES')} — revisa el
          signing secret en el proveedor.
        </p>
      ) : null}
      {w.aviso ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-400">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {w.aviso}
        </p>
      ) : null}
      {w.secret.pista ? <p className="text-muted-foreground mt-2 text-xs">{w.secret.pista}</p> : null}
      {w.doc ? (
        <a
          href={w.doc}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline"
        >
          Cómo configurarlo (limitaciones incluidas) <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  )
}

/** Bloque superior del panel de Integraciones: los 5 webhooks entrantes de la subcuenta. */
export function WebhooksEntrantesPanel({ webhooks, tenant }: { webhooks: WebhookEntranteEstado[]; tenant: string }) {
  const [abierto, setAbierto] = useState(true)

  if (!webhooks.length) return null
  const conAlgunEvento = webhooks.some((w) => w.ultimoEvento)

  return (
    <section className="border-border space-y-3 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Radio className="h-4 w-4" aria-hidden />
            Webhooks entrantes
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            URLs que llaman los proveedores para avisar de eventos en tiempo real. Cada una lleva el identificador de
            esta subcuenta y su propio secreto. «—» = todavía no ha llegado ninguno.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAbierto((v) => !v)}>
          {abierto ? 'Plegar' : 'Desplegar'}
        </Button>
      </div>
      {abierto ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {webhooks.map((w) => (
            <FilaWebhook key={w.id} w={w} tenant={tenant} />
          ))}
        </div>
      ) : null}
      {!conAlgunEvento ? (
        <p className="text-muted-foreground text-xs">
          Ningún webhook ha recibido todavía eventos con constancia. Los pulls programados (cron) y el botón «Cargar
          histórico» cubren los datos aunque el webhook no entre — el webhook aporta el tiempo real.
        </p>
      ) : null}
    </section>
  )
}
