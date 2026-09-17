'use client'

// Las cuentas seleccionadas en Integraciones, disponibles para cualquier pantalla.
//
// POR QUÉ UN HOOK Y NO UNA CONSULTA EN CADA PANTALLA. La selección vive en la configuración de la
// subcuenta, que es server-side y va junto a las credenciales. Sin esto, cada pantalla acababa
// leyendo `campaigns` entero —las catorce cuentas que ve el token— y presentándolo como si fuera el
// negocio. Aquí se pide una vez, por el endpoint que no expone tokens.
//
// MIENTRAS CARGA, `listo` es false y `filtrar()` deja pasar todo. Es deliberado: pintar cero durante
// el primer render sería peor que pintar de más durante un instante, porque un cero se lee como un
// dato y la gente toma decisiones con él.

import { useEffect, useMemo, useState } from 'react'

type Respuesta = {
  meta: { seleccionadas: string[]; todas: boolean; nombres?: Record<string, string> }
}

export function useCuentasMetaActivas(tenant: string) {
  const [datos, setDatos] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/${tenant}/evergreen/integraciones/cuentas-activas`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j: Respuesta) => vivo && setDatos(j))
      .catch((e: unknown) => vivo && setError(e instanceof Error ? e.message : 'No se pudo leer la selección'))
    return () => {
      vivo = false
    }
  }, [tenant])

  return useMemo(() => {
    const seleccionadas = datos?.meta.seleccionadas ?? []
    const todas = datos?.meta.todas ?? true
    const permitidas = new Set(seleccionadas)
    return {
      seleccionadas,
      /** Vacío = todas las accesibles, el mismo convenio que la sincronización y el panel. */
      todas,
      /** Nombre legible por cuenta (id → nombre), para selectores; cae al id si no hay nombre. */
      nombres: datos?.meta.nombres ?? {},
      listo: datos !== null,
      error,
      /** ¿Entra esta fila? Una fila sin cuenta (campaña manual) siempre entra. */
      incluye(accountId: string | null | undefined): boolean {
        if (todas || !datos) return true
        if (!accountId) return true
        return permitidas.has(accountId)
      },
      /** Filtra una lista por la cuenta seleccionada. */
      filtrar<T extends { account_id?: string | null }>(filas: T[]): T[] {
        if (todas || !datos) return filas
        return filas.filter((f) => !f.account_id || permitidas.has(f.account_id))
      },
    }
  }, [datos, error])
}
