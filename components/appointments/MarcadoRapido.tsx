'use client'

// MARCADO RÁPIDO DEL RESULTADO DE UNA LLAMADA.
//
// Tiene que cerrarse en segundos o no se rellena, y si no se rellena el Pitch Rate y el Close Rate
// se quedan en NOT_TRACKED para siempre. De ahí las tres decisiones de diseño:
//
// 1. NO HAY BOTÓN "GUARDAR". Cada clic escribe. Un formulario con botón final significa que cerrar el
//    panel por error pierde el trabajo, y que hay que acordarse de pulsarlo — dos razones para que la
//    gente deje de marcar a la semana.
// 2. SOLO SE PREGUNTA LO QUE NO SE PUEDE DEDUCIR. Marcar "Venta" ya implica que asistió y que hubo
//    oferta, así que el servidor las rellena y aquí no se piden. Las filas de oferta y de seguimiento
//    aparecen solo cuando tienen sentido: preguntar por la oferta de una llamada a la que nadie vino
//    es pedir un dato imposible.
// 3. LAS REGLAS NO SE REIMPLEMENTAN AQUÍ. La UI decide qué MOSTRAR; qué es válido lo decide
//    lib/agenda/marcado.ts, que es lo que también aplica la ruta. Si esta pantalla tuviera su propia
//    idea de lo válido, acabarían discrepando y el 422 saldría por sorpresa.
//
// `null` no es `false`. Un botón sin pulsar se pinta sin seleccionar, no como "No": la diferencia
// entre "no asistió" y "nadie lo ha marcado" es exactamente lo que separa un Show Rate real de uno
// inventado.

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, X, Loader2, Video } from 'lucide-react'
import { RESULTADOS, RESULTADO_LABELS, type Marcado, type Resultado } from '@/lib/agenda/marcado'

type Cita = {
  id: string
  status?: string | null
  offered?: boolean | null
  result?: string | null
  needs_followup?: boolean | null
  /** Evidencia de que la llamada existió y está grabada. Sirve para marcar con la prueba delante. */
  fathom_meeting_id?: string | null
  recording_url?: string | null
}

type Props = {
  tenant: string
  cita: Cita
  /** Se avisa al padre para que la fila de la tabla se refresque sin recargar la página. */
  onMarcado?: (id: string, cambios: Partial<Cita>) => void
}

/** Un par Sí/No. Sin seleccionar cuando el valor es null: eso significa "sin marcar". */
function SiNo({
  valor,
  onChange,
  disabled,
  etiquetaSi = 'Sí',
  etiquetaNo = 'No',
}: {
  valor: boolean | null | undefined
  onChange: (v: boolean) => void
  disabled?: boolean
  etiquetaSi?: string
  etiquetaNo?: string
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50'
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={valor === true}
        onClick={() => onChange(true)}
        className={`${base} ${valor === true ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border text-muted-foreground hover:text-foreground'}`}
      >
        <Check className="h-3.5 w-3.5" /> {etiquetaSi}
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={valor === false}
        onClick={() => onChange(false)}
        className={`${base} ${valor === false ? 'border-destructive bg-destructive text-white' : 'border-border text-muted-foreground hover:text-foreground'}`}
      >
        <X className="h-3.5 w-3.5" /> {etiquetaNo}
      </button>
    </div>
  )
}

export function MarcadoRapido({ tenant, cita, onMarcado }: Props) {
  const [guardando, setGuardando] = useState<string | null>(null)
  // Estado local para que el botón reaccione al instante; la verdad sigue siendo lo que devuelve el
  // servidor, y si la escritura falla se revierte.
  const [local, setLocal] = useState<Cita>(cita)

  const asistio =
    local.status === 'show' || local.status === 'completed' ? true : local.status === 'no_show' ? false : null
  const oferta = local.offered ?? null
  const resultado = (local.result ?? null) as Resultado | null
  const seguimiento = local.needs_followup ?? null

  const grabacion = local.fathom_meeting_id || local.recording_url

  async function marcar(m: Marcado, campo: string, optimista: Partial<Cita>) {
    const previo = local
    setGuardando(campo)
    setLocal((x) => ({ ...x, ...optimista }))
    try {
      const res = await fetch(`/api/${tenant}/evergreen/appointments/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: local.id, patch: { marcado: m } }),
      })
      const data = await res.json()
      if (!res.ok || data?.error) throw new Error(data?.error || 'No se pudo marcar')
      // El servidor avisa de lo que ha deducido (una venta implica oferta). Se dice, no se hace en
      // silencio: quien marca tiene que poder ver qué ha quedado escrito.
      if (Array.isArray(data.avisos) && data.avisos.length > 0) {
        toast.success('Marcado', { description: data.avisos.join(' ') })
      }
      onMarcado?.(local.id, optimista)
    } catch (err) {
      setLocal(previo)
      toast.error('No se pudo marcar', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setGuardando(null)
    }
  }

  const cargando = (campo: string) => guardando === campo

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Resultado de la llamada</h3>
        {grabacion ? (
          local.recording_url ? (
            <a
              href={local.recording_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Video className="h-3.5 w-3.5" /> Ver grabación
            </a>
          ) : (
            // Hay constancia de la llamada en Fathom aunque no tengamos URL directa. Se dice, porque
            // es la prueba de que ocurrió y ayuda a marcar sin dudar.
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Video className="h-3.5 w-3.5" /> Grabada en Fathom
            </span>
          )
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="w-28 text-xs text-muted-foreground">¿Asistió?</span>
        <SiNo
          valor={asistio}
          disabled={cargando('asistio')}
          onChange={(v) =>
            marcar({ asistio: v }, 'asistio', { status: v ? 'show' : 'no_show', ...(v ? {} : { offered: false }) })
          }
        />
        {cargando('asistio') && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {/* La oferta solo se pregunta si hubo llamada: no se puede presentar nada a quien no vino. */}
      {asistio === true && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="w-28 text-xs text-muted-foreground">¿Oferta?</span>
          <SiNo
            valor={oferta}
            disabled={cargando('oferta')}
            onChange={(v) => marcar({ asistio: true, ofertaPresentada: v }, 'oferta', { offered: v })}
          />
          {cargando('oferta') && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          {/* Cualificada ES haber recibido la oferta. Se dice aquí para que nadie busque otro campo. */}
          <span className="text-[11px] text-muted-foreground">Marcarla cuenta la llamada como cualificada</span>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <span className="w-28 pt-1.5 text-xs text-muted-foreground">Resultado</span>
        <div className="flex flex-wrap gap-2">
          {RESULTADOS.map((r) => (
            <button
              key={r}
              type="button"
              disabled={cargando('resultado')}
              aria-pressed={resultado === r}
              onClick={() =>
                marcar({ resultado: r }, 'resultado', {
                  result: r,
                  // Se refleja lo que el servidor va a deducir, para que el panel no parpadee.
                  ...(r === 'venta' ? { status: 'show', offered: true } : {}),
                  ...(r === 'no_show' ? { status: 'no_show', offered: false } : {}),
                })
              }
              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                resultado === r
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {RESULTADO_LABELS[r]}
            </button>
          ))}
          {cargando('resultado') && <Loader2 className="mt-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* El seguimiento solo tiene sentido en una llamada celebrada que no cerró: es el denominador
          del BAMFAM. Preguntarlo tras una venta sería pedir un dato que no se va a usar. */}
      {asistio === true && resultado !== 'venta' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="w-28 text-xs text-muted-foreground">¿Siguiente reunión?</span>
          <SiNo
            valor={seguimiento}
            disabled={cargando('seguimiento')}
            etiquetaSi="Agendada"
            etiquetaNo="No"
            onChange={(v) => marcar({ seguimientoAgendado: v }, 'seguimiento', { needs_followup: v })}
          />
          {cargando('seguimiento') && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      )}
    </div>
  )
}
