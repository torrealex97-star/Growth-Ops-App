'use client'

import { useEffect, useState } from 'react'
import { useTenant } from '@/lib/tenant-context'
import { pedir } from '@/lib/ui/pedir'
import { InlineSpinner } from '@/components/ui/carga/AppLoading'
import type { GrowthBrief } from '@/lib/metrics/brief'

// LA CABECERA DEL AGENTE: un brief, no un cuadro de texto vacío.
//
// EL PROBLEMA QUE RESUELVE, dicho por quien lo pidió: "su pantalla inicial no fuese un chatbot vacío".
// Un chat en blanco traslada a la persona el trabajo de saber qué preguntar, y el resultado es que no se
// usa. Aquí el agente abre diciendo lo que ya sabe —salud, restricción, impacto y acción— y el chat queda
// para lo que no cabe en cuatro líneas.
//
// NO RECALCULA NADA: pide el mismo /metricas/brief que pinta el panel de Analítica. Si el agente calculara
// su propia versión, el chat y el panel podrían discrepar sobre el mismo negocio, y entonces la persona no
// se cree a ninguno de los dos.
//
// FALLA EN SILENCIO A PROPÓSITO. Si el brief no se puede cargar, esta cabecera no se pinta y el chat sigue
// funcionando: es un extra útil, no un requisito. Un aviso de error aquí convertiría un problema de
// métricas en una avería aparente del agente.

type Respuesta = { brief: GrowthBrief; salud: { puntuacion: number | null; etiqueta: string } }

export function GrowthBriefCabecera({ onPreguntar }: { onPreguntar: (texto: string) => void }) {
  const tenant = useTenant()
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const ac = new AbortController()
    void (async () => {
      try {
        const res = await pedir<Respuesta>(`/api/${tenant}/evergreen/metricas/brief`, { signal: ac.signal })
        if (res.ok) setDatos(res.data)
      } finally {
        setCargando(false)
      }
    })()
    return () => ac.abort()
  }, [tenant])

  if (cargando) {
    return (
      <div className="rounded-lg border border-border bg-background px-3 py-2">
        <InlineSpinner etiqueta="Preparando tu brief…" />
        <span className="ml-2 text-xs text-muted-foreground">Preparando tu brief…</span>
      </div>
    )
  }
  // Sin brief no se enseña nada: el chat de abajo sigue sirviendo.
  if (!datos) return null

  const { brief, salud } = datos

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Growth Brief</h3>
        <span className="text-xs tabular-nums text-muted-foreground">
          Salud {salud.puntuacion === null ? 's/d' : `${salud.puntuacion}/100`}
        </span>
      </div>

      <dl className="space-y-1.5 text-xs">
        <div>
          <dt className="text-muted-foreground">Restricción</dt>
          <dd className="text-foreground">{brief.restriccion.titular}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Impacto</dt>
          <dd className="text-foreground">{brief.impacto.texto}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Acción recomendada</dt>
          <dd className="text-foreground">{brief.accion.texto}</dd>
        </div>
      </dl>

      {/* El botón manda al agente EL BRIEF QUE YA ESTÁ CALCULADO, no una pregunta vaga: así no gasta
          rondas de herramientas en recalcular lo que el panel acaba de decirle. */}
      <button
        type="button"
        onClick={() =>
          onPreguntar(
            `Sobre este brief: ${brief.resumenParaAgente}\n\n¿Cuál es el siguiente paso concreto para mover esa restricción, y qué mirar para saber si funcionó?`
          )
        }
        className="w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Preguntar al Growth AI sobre esto
      </button>
    </div>
  )
}
