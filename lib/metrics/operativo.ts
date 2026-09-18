// REALIDAD OPERACIONAL del negocio, sin atribución exigida.
//
// Este tipo vive aparte para que el funnel dinámico del dashboard (FunnelDinamico) y la página que
// calcula los totales (unit-economics) compartan la MISMA forma. Si viviera dentro de la página,
// el componente acabaría redefiniéndola y las dos definiciones discreparían con el tiempo.
//
// La regla de negocio que lo gobierna (fase 2 del rediseño de captación): los totales cuentan lo
// que ocurrió de verdad en el CRM. La parte atribuida a anuncios va en `atribuidos`, separada,
// porque la ausencia de atribución NO significa que el evento no haya ocurrido.

export type FunnelOperativo = {
  leads: number
  agendas: number
  asistencias: number
  cierres: number
  facturacion: number
  atribuidos: {
    agendas: number
    cierres: number
    facturacion: number
  }
}

// Canales del filtro avanzado. Solo canales que la app de verdad puede saber hoy: los que
// cubre `contacts.utm_source`/`contact_attributions` y las campañas sincronizadas. Instagram,
// YouTube y TikTok orgánicos entran cuando su integración los traiga — no antes.
const CANALES_FILTRO = [
  { id: 'meta', label: 'Meta' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'google', label: 'Google' },
  { id: 'direct', label: 'Directo' },
  { id: 'referral', label: 'Referidos' },
] as const

export type FiltroAtribucion = 'todos' | 'atribuidos' | 'no_atribuidos'
type FiltroOrigen = 'todos' | 'paid' | 'organic' | 'direct' | 'referral'
