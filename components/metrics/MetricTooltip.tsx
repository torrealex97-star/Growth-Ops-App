'use client'

// TOOLTIP EDUCATIVO DE UNA MÉTRICA.
//
// POR QUÉ 2 SEGUNDOS DE ESPERA. Un tooltip inmediato convierte cualquier barrido del ratón por un
// panel de doce tarjetas en una sucesión de recuadros saltando por la pantalla. El retardo hace que
// solo aparezca cuando alguien se ha PARADO a mirar, que es justo cuando la explicación ayuda.
//
// POR QUÉ NO SE AÑADE UNA DEPENDENCIA. En el proyecto no hay tooltip de Radix, y las librerías de
// tooltip no permiten un retardo de 2s sin pelearse con sus valores por defecto. Son treinta líneas
// de estado y un temporizador; una dependencia nueva para esto no se justifica.
//
// EN MÓVIL NO HAY HOVER, así que la misma explicación se abre pulsando el icono de información. No es
// una versión reducida: es el mismo contenido por otra vía, porque quien usa el panel desde el móvil
// necesita entender los números igual que quien lo usa desde el escritorio.

import { useEffect, useId, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Los 2000 ms que pide el diseño, en un solo sitio. */
export const RETARDO_TOOLTIP_MS = 2000

export type ContenidoTooltip = {
  nombre: string
  queEs: string
  formula: string
  porQueImporta: string
  fuente: string
  /** Solo si existe objetivo declarado. No se inventa uno para rellenar el hueco. */
  objetivo?: string | null
  /** Se enseña solo cuando no es alta: una fiabilidad baja cambia cómo hay que leer el número. */
  fiabilidad?: 'alta' | 'media' | 'baja'
  /** Por qué el dato está incompleto, cuando lo está. */
  notaDato?: string
}

const ETIQUETA_FIABILIDAD: Record<'alta' | 'media' | 'baja', string> = {
  alta: 'Alta — fuente directa',
  media: 'Media — dato interpretado o incompleto',
  baja: 'Baja — fuente no conectada o dato sin determinar',
}

export function MetricTooltip({
  contenido,
  children,
  className,
}: {
  contenido: ContenidoTooltip
  /** El elemento que dispara el tooltip: el nombre de la métrica, su valor o la tarjeta entera. */
  children: React.ReactNode
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  const id = useId()

  // El temporizador se limpia al desmontar: sin esto, salir de la pantalla con el ratón encima deja
  // un setTimeout apuntando a un componente que ya no existe.
  useEffect(() => () => void (temporizador.current && clearTimeout(temporizador.current)), [])

  const cancelar = () => {
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = null
  }

  const alEntrar = () => {
    cancelar()
    temporizador.current = setTimeout(() => setAbierto(true), RETARDO_TOOLTIP_MS)
  }

  // Al salir desaparece, y se cancela la espera pendiente: si no, pasar por encima y seguir de largo
  // haría aparecer el recuadro dos segundos después, ya sin el ratón ahí.
  const alSalir = () => {
    cancelar()
    setAbierto(false)
  }

  return (
    <span
      className={cn('relative inline-flex items-center gap-1.5', className)}
      onMouseEnter={alEntrar}
      onMouseLeave={alSalir}
      // El teclado no espera: quien navega con tabulador ya ha señalado intención al enfocar.
      onFocus={() => setAbierto(true)}
      onBlur={alSalir}
    >
      {children}

      <button
        type="button"
        aria-label={`Qué significa ${contenido.nombre}`}
        aria-expanded={abierto}
        aria-describedby={abierto ? id : undefined}
        // En móvil esta es la única vía, así que el área táctil no puede ser el icono de 14px a secas.
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={(e) => {
          e.stopPropagation()
          cancelar()
          setAbierto((v) => !v)
        }}
      >
        <Info className="h-3.5 w-3.5" />
      </button>

      {abierto && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-3 text-left shadow-lg"
        >
          <span className="block text-xs font-semibold uppercase tracking-wide text-foreground">
            {contenido.nombre}
          </span>

          <Bloque titulo="Qué es">{contenido.queEs}</Bloque>
          <Bloque titulo="Fórmula">
            <span className="font-mono text-[11px]">{contenido.formula}</span>
          </Bloque>
          <Bloque titulo="Por qué importa">{contenido.porQueImporta}</Bloque>
          <Bloque titulo="Fuente">{contenido.fuente}</Bloque>

          {/* El objetivo solo aparece si existe. Un "objetivo: —" invita a pensar que falta configurar
              algo, cuando puede ser que esa métrica no deba tener objetivo. */}
          {contenido.objetivo ? <Bloque titulo="Objetivo">{contenido.objetivo}</Bloque> : null}

          {/* La fiabilidad se enseña solo cuando NO es alta: decir "fiabilidad: alta" en las doce
              tarjetas es ruido, y avisar de una media o baja es información. */}
          {contenido.fiabilidad && contenido.fiabilidad !== 'alta' ? (
            <Bloque titulo="Fiabilidad del dato">{ETIQUETA_FIABILIDAD[contenido.fiabilidad]}</Bloque>
          ) : null}

          {contenido.notaDato ? <Bloque titulo="Sobre este dato">{contenido.notaDato}</Bloque> : null}
        </span>
      )}
    </span>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <span className="mt-2 block">
      <span className="block text-[11px] font-medium text-muted-foreground">{titulo}</span>
      <span className="block text-xs leading-snug text-foreground">{children}</span>
    </span>
  )
}
