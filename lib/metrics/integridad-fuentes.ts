import type { Agregados } from './agregados'

// Dependencias de lectura: una fuente fallida o recortada invalida también sus ratios.
const DEPENDENCIAS: Record<string, string[]> = {
  ventas: [
    'contracted_revenue',
    'ventas',
    'aov',
    'cac',
    'cash_collection_ratio',
    'close_rate_llamadas',
    'close_rate_ofertas',
  ],
  cobros: ['cash_collected', 'cash_collection_ratio', 'cash_roas'],
  stripe: ['cash_collected', 'cash_collection_ratio', 'cash_roas'],
  campanas: ['ad_spend', 'cash_roas', 'cac', 'ctr', 'cpc', 'cpm', 'cpqbc'],
  citas: [
    'agendas',
    'agendas_cualificadas',
    'show_rate',
    'pitch_rate',
    'close_rate_llamadas',
    'close_rate_ofertas',
    'cpqbc',
    'bamfam_rate',
    'tasa_concordancia_cualificacion',
  ],
  contactos: ['speed_to_lead'],
}

export function protegerFuentes(mediciones: Agregados, fuentesInvalidas: string[]): Agregados {
  const salida = { ...mediciones }
  for (const fuente of fuentesInvalidas) {
    for (const key of DEPENDENCIAS[fuente] ?? []) {
      if (salida[key])
        salida[key] = {
          valor: null,
          muestra: null,
          motivo: `Fuente incompleta o no disponible: ${fuente}. No se calculan totales parciales.`,
        }
    }
  }
  return salida
}
