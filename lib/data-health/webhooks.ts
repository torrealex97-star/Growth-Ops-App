// SALUD DE LOS WEBHOOKS ENTRANTES — la mitad que ESPERA datos.
//
// "Estado de las sincronizaciones" mira la mitad que SALE a buscar (crons y botones de pull). La
// mitad que espera — el webhook al que GHL llama — puede llevar días sin recibir nada y ninguna
// tarjeta se entera: los conectores ven su propio pull, no la recepción. Este control mira la capa
// en bruto (`raw_events`), que es la evidencia de recepción REAL: si la integración está
// configurada y no entra un sobre en 24h, el tiempo real está roto aunque el cron disimule los
// síntomas trayendo datos viejos.
//
// DOS REGLAS del resto del módulo también gobiernan aquí:
//  · Un hueco no es un cero: si la consulta falla, el estado es `desconocido`, nunca "al día".
//  · Una integración que la subcuenta no usa no es una avería: `sin_configurar` no avisa.

export type EstadoSobreGhl = 'al_dia' | 'silencio' | 'sin_configurar' | 'desconocido'

export type SaludSobreGhl = {
  estado: EstadoSobreGhl
  /** Qué significa y qué mirar. Una frase, sin códigos. */
  mensaje: string
  /** ISO del último sobre recibido. `null` = ninguno o no se pudo leer. */
  ultimoSobre: string | null
  /** Horas transcurridas desde el último sobre. `null` = no se sabe. */
  horasDesde: number | null
}

/** Silencio de la mitad receptora que ya merece aviso: 24 h sin sobres con la integración viva. */
export const SILENCIO_WEBHOOK_MS = 24 * 60 * 60 * 1000

export function saludSobreGhl(input: {
  /** La subcuenta usa GHL: credenciales de integración o secret del webhook configurados. */
  configurado: boolean
  /** ISO del último sobre de GHL en `raw_events`. `null` = ninguno. */
  ultimoSobre: string | null
  /** `false` = la capa en bruto no se pudo leer: no se afirma que esté al día. */
  leido?: boolean
  umbralMs?: number
  ahora?: number
}): SaludSobreGhl {
  const umbral = input.umbralMs ?? SILENCIO_WEBHOOK_MS
  const ahora = input.ahora ?? Date.now()

  if (!input.configurado) {
    return {
      estado: 'sin_configurar',
      mensaje: 'Esta subcuenta no tiene GHL configurado: el control solo aplica a quien lo usa.',
      ultimoSobre: null,
      horasDesde: null,
    }
  }
  if (input.leido === false) {
    return {
      estado: 'desconocido',
      mensaje: 'No se pudo leer la capa de eventos en bruto: no se sabe cuándo entró el último sobre.',
      ultimoSobre: null,
      horasDesde: null,
    }
  }
  if (!input.ultimoSobre) {
    return {
      estado: 'silencio',
      mensaje:
        'GHL está configurado pero el webhook nunca ha recibido un sobre: el alta en GHL o el secret no están funcionando.',
      ultimoSobre: null,
      horasDesde: null,
    }
  }
  const t = Date.parse(input.ultimoSobre)
  if (Number.isNaN(t)) {
    return {
      estado: 'desconocido',
      mensaje: 'La fecha del último sobre no se puede interpretar: revisa la capa de eventos en bruto.',
      ultimoSobre: input.ultimoSobre,
      horasDesde: null,
    }
  }
  const horas = (ahora - t) / 3_600_000
  if (ahora - t >= umbral) {
    return {
      estado: 'silencio',
      mensaje: `Sin sobres de GHL desde hace ${Math.round(horas)} h (umbral 24 h): el tiempo real está roto, aunque el cron siga trayendo datos.`,
      ultimoSobre: input.ultimoSobre,
      horasDesde: horas,
    }
  }
  return {
    estado: 'al_dia',
    mensaje: `Último sobre recibido hace ${Math.round(horas)} h.`,
    ultimoSobre: input.ultimoSobre,
    horasDesde: horas,
  }
}
