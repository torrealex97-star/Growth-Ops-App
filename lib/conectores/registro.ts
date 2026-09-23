import { INTEGRATION_GROUPS } from '@/lib/integrations-catalog'

import type { Conector } from './contrato'
import { conector as plantilla } from './_plantilla/index'

// F2 — REGISTRO DE CONECTORES.
//
// Un solo sitio donde se declara qué conectores existen. La suite de contrato recorre ESTE registro,
// así que un conector nuevo queda cubierto por todas las comprobaciones sin tocar los tests: se
// añade aquí y ya se le exige el contrato entero.
//
// La plantilla entra a propósito: si el ejemplo que todo el mundo copia no pasara la suite, estaría
// enseñando a incumplirla.

export const CONECTORES: Conector[] = [plantilla]

/** Un conector por su proveedor. `undefined` = todavía no está migrado al contrato. */
export function conectorDe(provider: string): Conector | undefined {
  return CONECTORES.find((c) => c.manifest.provider === provider)
}

/**
 * Proveedores del catálogo de Integraciones que aún NO tienen conector.
 *
 * Es la lista de trabajo de F2, calculada en vez de escrita a mano: según se migren integraciones,
 * se vacía sola. Escrita a mano se quedaría vieja al segundo conector.
 */
export function pendientesDeMigrar(): string[] {
  const conContrato = new Set(CONECTORES.map((c) => c.manifest.provider))
  return INTEGRATION_GROUPS.filter((g) => g.surface !== 'empresa' && !conContrato.has(g.id))
    .map((g) => g.id)
    .sort()
}
