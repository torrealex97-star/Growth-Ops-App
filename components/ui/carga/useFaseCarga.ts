'use client'

import { useEffect, useRef, useState } from 'react'
import { faseCarga, RETARDO_LOADER_MS, UMBRAL_LENTO_MS, type FaseCarga } from '@/lib/ui/carga'

/**
 * La fase del loader, con reloj.
 *
 * El cronómetro se reinicia cada vez que arranca una carga nueva: sin eso, la segunda carga de una
 * pantalla heredaría el "está tardando" de la primera y avisaría de un problema que ya no existe.
 *
 * Los timers se limpian SIEMPRE al desmontar. Un setTimeout pendiente sobre un componente
 * desmontado es el otro camino por el que un loader se queda pegado.
 */
export function useFaseCarga(cargando: boolean, opciones: { retardoMs?: number; lentoMs?: number } = {}): FaseCarga {
  const retardo = opciones.retardoMs ?? RETARDO_LOADER_MS
  const lento = opciones.lentoMs ?? UMBRAL_LENTO_MS
  const [ms, setMs] = useState(0)
  const inicio = useRef<number | null>(null)

  useEffect(() => {
    if (!cargando) {
      inicio.current = null
      setMs(0)
      return
    }
    inicio.current = Date.now()
    setMs(0)
    const aVisible = setTimeout(() => setMs(retardo), retardo)
    const aLento = setTimeout(() => setMs(lento), lento)
    return () => {
      clearTimeout(aVisible)
      clearTimeout(aLento)
    }
  }, [cargando, retardo, lento])

  return faseCarga(cargando, ms, { retardoMs: retardo, lentoMs: lento })
}
