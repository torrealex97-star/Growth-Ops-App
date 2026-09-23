import type { ConnectorManifest } from '@/lib/conectores/contrato'
import { isRetryableCode, redactSecrets, type SyncRunSummary } from '@/lib/integrations/sync-runs'

// SALUD DE DATOS POR CONECTOR.
//
// Lo que pide F2, literal: "Data Health muestra last sync, cursor, error o backoff y estado de
// credenciales sin exponer secretos".
//
// POR QUÉ NO BASTA LO QUE YA HABÍA. La pantalla de Salud de datos deduce el estado de cada fuente de
// las FILAS que hay en las tablas: última fecha vista, cuántos registros. Eso responde "¿hay datos?"
// pero no "¿sigue entrando?". Una integración que lleva cinco días fallando enseña tan campante la
// fecha del último dato bueno, y nadie ve el fallo hasta que alguien echa de menos algo. Aquí el
// estado sale del HISTORIAL DE EJECUCIONES y del manifiesto del conector, que es lo que de verdad
// dice si la tubería sigue abierta.
//
// SIN SECRETOS, POR CONSTRUCCIÓN: de las credenciales solo viajan NOMBRES de claves y un booleano.
// Los mensajes de error se vuelven a redactar aquí aunque ya se guardaran redactados: esta salida va
// a una pantalla, y una segunda pasada es barata comparada con filtrar un token.

/** Estado de credenciales. Nunca lleva valores: solo qué falta, por su nombre. */
export type EstadoCredenciales = {
  completas: boolean
  /** Nombres de las claves que faltan, tal y como se llaman en Integraciones. */
  faltan: string[]
}

export type UltimaEjecucion = {
  job: string
  estado: SyncRunSummary['status']
  /** Cuándo empezó. Es lo único que siempre se sabe. */
  empezoEn: string
  /** Milisegundos que duró, o `null` si no se puede saber (se cortó y la cerró el barrido). */
  duracionMs: number | null
  filasEscritas: number | null
}

export type Incidencia = {
  mensaje: string
  codigo: string | null
  /** `true` = el fallo es del transporte y la próxima pasada puede arreglarlo sola. */
  seReintentaSolo: boolean
}

export type SaludConector = {
  provider: string
  label: string
  /** Cómo entran los datos, en una frase, derivada del manifiesto. */
  comoEntra: string
  credenciales: EstadoCredenciales
  ultima: UltimaEjecucion | null
  incidencia: Incidencia | null
  /** Qué sabe el conector de dónde se quedó. */
  cursor: { soportado: boolean; motivo: string }
  /**
   * Veredicto para la pantalla. `sin_credenciales` NO es un fallo: es una integración que esta
   * subcuenta no usa, y confundirlas es lo que llenaba el historial de averías falsas (S0.7 §3.5).
   */
  estado: 'al_dia' | 'en_curso' | 'fallando' | 'sin_credenciales' | 'nunca_ejecutada'
}

const FRASES_ENTRADA: Record<string, string> = {
  webhook: 'el proveedor avisa al ocurrir',
  incremental: 'pasadas incrementales',
  backfill: 'pasadas completas',
  manual: 'a mano desde la pantalla',
}

function comoEntra(m: ConnectorManifest): string {
  const frases = m.syncModes.map((s) => FRASES_ENTRADA[s] ?? s)
  return frases.length ? frases.join(' + ') : 'sin vía de entrada declarada'
}

/** Milisegundos entre inicio y fin. `null` cuando falta el fin: un hueco no es un cero. */
export function duracionDe(run: SyncRunSummary): number | null {
  if (!run.finishedAt) return null
  const ini = Date.parse(run.startedAt)
  const fin = Date.parse(run.finishedAt)
  if (Number.isNaN(ini) || Number.isNaN(fin) || fin < ini) return null
  return fin - ini
}

/**
 * Construye la fila de un conector. PURO: recibe los hechos ya leídos y no toca red ni base, que es
 * lo que permite probar los casos raros (nunca ejecutada, sin credenciales, cortada) sin montar nada.
 */
export function saludDeConector(
  manifest: ConnectorManifest,
  hechos: { clavesConfiguradas: Set<string>; ejecuciones: Record<string, SyncRunSummary | null> }
): SaludConector {
  const faltan = manifest.requiredKeys.filter((k) => !hechos.clavesConfiguradas.has(k))
  const credenciales: EstadoCredenciales = { completas: faltan.length === 0, faltan }

  // La última ejecución del proveedor, sea cual sea el job: Meta tiene tres pasadas distintas y
  // mirar solo una diría "al día" con las otras dos caídas.
  const suyas = Object.values(hechos.ejecuciones)
    .filter((r): r is SyncRunSummary => !!r && r.provider === manifest.provider)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  const ultimaFila = suyas[0] ?? null
  // Un fallo importa aunque después haya corrido otra pasada distinta: son tuberías separadas.
  const fallida = suyas.find((r) => r.status === 'error' || r.status === 'timeout') ?? null

  const ultima: UltimaEjecucion | null = ultimaFila
    ? {
        job: ultimaFila.job,
        estado: ultimaFila.status,
        empezoEn: ultimaFila.startedAt,
        duracionMs: duracionDe(ultimaFila),
        filasEscritas: ultimaFila.rowsWritten,
      }
    : null

  const incidencia: Incidencia | null = fallida
    ? {
        // Segunda redacción a propósito: esto se pinta en una pantalla.
        mensaje: redactSecrets(fallida.errorMessage ?? 'Falló sin dejar mensaje.'),
        codigo: fallida.errorCode,
        seReintentaSolo: isRetryableCode(fallida.errorCode),
      }
    : null

  const soportaCursor = manifest.syncModes.includes('incremental')
  const cursor = {
    soportado: soportaCursor,
    motivo: soportaCursor
      ? 'Reanuda donde lo dejó.'
      : 'Este proveedor no reanuda por cursor: cada pasada vuelve a pedir la ventana entera.',
  }

  let estado: SaludConector['estado']
  if (!credenciales.completas) estado = 'sin_credenciales'
  else if (ultimaFila?.status === 'running') estado = 'en_curso'
  else if (!ultimaFila) estado = 'nunca_ejecutada'
  else if (incidencia) estado = 'fallando'
  else estado = 'al_dia'

  return {
    provider: manifest.provider,
    label: manifest.label,
    comoEntra: comoEntra(manifest),
    credenciales,
    ultima,
    incidencia,
    cursor,
    estado,
  }
}
