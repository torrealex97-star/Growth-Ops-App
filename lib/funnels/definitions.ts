// Definición de las cuatro familias de funnel. Una sola fuente de verdad para el ORDEN y el
// SIGNIFICADO de cada etapa: si la UI y el cálculo tuvieran su propia lista, tarde o temprano
// discreparían y nadie sabría cuál de las dos miente.
import type { FunnelSource } from '@/lib/funnels/types'

export type FunnelFamily = 'vsl' | 'webinar' | 'profile' | 'web_seo'

export type StageDef = {
  /** Clave estable: se usa en URLs de drill-down y en la base, así que no se renombra a la ligera. */
  id: string
  label: string
  /** De dónde sale el recuento de esta etapa. */
  source: FunnelSource
  /**
   * Qué cuenta la etapa. 'personas' se puede deduplicar por contacto; 'eventos' no.
   * Mezclarlas en una misma tasa de conversión da porcentajes por encima del 100 %.
   */
  counts: 'personas' | 'eventos'
  /** Tabla/vista a la que lleva el drill-down "ver los registros que componen esta métrica". */
  drilldown?: 'contacts' | 'appointments' | 'sales'
}

export type FunnelDef = {
  family: FunnelFamily
  label: string
  description: string
  stages: StageDef[]
}

const AGENDA: StageDef = {
  id: 'agendas',
  label: 'Agendas',
  source: 'crm',
  counts: 'personas',
  drilldown: 'appointments',
}
const SHOW: StageDef = {
  id: 'llamadas',
  label: 'Llamadas realizadas',
  source: 'crm',
  counts: 'personas',
  drilldown: 'appointments',
}
const CIERRE: StageDef = { id: 'cierres', label: 'Cierres', source: 'crm', counts: 'personas', drilldown: 'sales' }

export const FUNNEL_DEFS: Record<FunnelFamily, FunnelDef> = {
  vsl: {
    family: 'vsl',
    label: 'VSL',
    description: 'Anuncio → landing con vídeo de venta → opt-in → llamada.',
    stages: [
      { id: 'impresiones', label: 'Impresiones', source: 'meta', counts: 'eventos' },
      { id: 'clics', label: 'Clics en el enlace', source: 'meta', counts: 'eventos' },
      { id: 'visitas', label: 'Visitas a la landing', source: 'vsl', counts: 'eventos' },
      { id: 'leads', label: 'Opt-ins', source: 'crm', counts: 'personas', drilldown: 'contacts' },
      AGENDA,
      SHOW,
      CIERRE,
    ],
  },
  webinar: {
    family: 'webinar',
    label: 'Webinar',
    description: 'Registro → asistencia → llamada. La asistencia es la etapa que más se cae.',
    stages: [
      { id: 'visitas', label: 'Visitas a la página de registro', source: 'vsl', counts: 'eventos' },
      { id: 'registros', label: 'Registros', source: 'crm', counts: 'personas', drilldown: 'contacts' },
      { id: 'asistentes', label: 'Asistentes', source: 'crm', counts: 'personas', drilldown: 'contacts' },
      AGENDA,
      SHOW,
      CIERRE,
    ],
  },
  profile: {
    family: 'profile',
    label: 'Perfil (Instagram)',
    description: 'Contenido → perfil → conversación por DM → llamada.',
    stages: [
      { id: 'alcance', label: 'Alcance', source: 'meta', counts: 'eventos' },
      { id: 'visitas_perfil', label: 'Visitas al perfil', source: 'meta', counts: 'eventos' },
      {
        id: 'conversaciones',
        label: 'Conversaciones por DM',
        source: 'crm',
        counts: 'personas',
        drilldown: 'contacts',
      },
      AGENDA,
      SHOW,
      CIERRE,
    ],
  },
  web_seo: {
    family: 'web_seo',
    label: 'Web / SEO',
    description: 'Tráfico orgánico y directo. Requiere GA4: sin él, esta familia no tiene visitas.',
    stages: [
      { id: 'sesiones', label: 'Sesiones', source: 'ga4', counts: 'eventos' },
      { id: 'leads', label: 'Leads', source: 'crm', counts: 'personas', drilldown: 'contacts' },
      AGENDA,
      SHOW,
      CIERRE,
    ],
  },
}

export const FUNNEL_FAMILIES = Object.keys(FUNNEL_DEFS) as FunnelFamily[]

export function stagesOf(family: FunnelFamily): StageDef[] {
  return FUNNEL_DEFS[family].stages
}

/** Fuentes distintas que hay que poder leer para pintar una familia completa. */
export function sourcesOf(family: FunnelFamily): FunnelSource[] {
  return [...new Set(stagesOf(family).map((s) => s.source))]
}
