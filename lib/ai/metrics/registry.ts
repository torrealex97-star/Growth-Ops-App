// Semantic Business Layer: definiciones canónicas de las métricas del negocio, en un solo sitio,
// para que el agente cite siempre la MISMA definición que el resto de la app (docs/METRICS.md)
// en vez de reformularla cada vez con sus propias palabras. Esto es documentación consultable
// por tool (getMetricDefinition), no una fórmula nueva — las fórmulas reales siguen viviendo en
// lib/ads/funnel.ts y lib/analytics.ts; este registro solo las describe.
export type MetricDefinition = {
  name: string
  definition: string
  formula: string
  source: string
  notes?: string
}

export const METRIC_REGISTRY: Record<string, MetricDefinition> = {
  lead: {
    name: 'Lead',
    definition: 'Persona que ha dejado sus datos de contacto a través de un formulario o anuncio.',
    formula: 'Recuento de contactos creados en el periodo (o meta_leads reportado por Meta Ads).',
    source: 'contacts, campaigns.meta_leads',
  },
  qualified_lead: {
    name: 'Lead cualificado',
    definition: 'Lead que cumple los criterios mínimos de encaje (presupuesto/urgencia/perfil) antes de agendar.',
    formula: 'contacts.lead_score o qualification de la cita, según disponibilidad.',
    source: 'contacts.lead_score, appointments.qualification',
  },
  booking: {
    name: 'Agenda / Booking',
    definition: 'Cita reservada en el calendario, con independencia de si luego se asiste.',
    formula: 'Recuento de appointments creadas en el periodo.',
    source: 'appointments',
  },
  show: {
    name: 'Show',
    definition: 'Cita a la que el lead SÍ asistió.',
    formula: "Recuento de appointments con status en ('show','completed').",
    source: 'appointments.status',
  },
  no_show: {
    name: 'No-show',
    definition: 'Cita agendada a la que el lead NO asistió.',
    formula: "Recuento de appointments con status = 'no_show'.",
    source: 'appointments.status',
  },
  sale: {
    name: 'Venta',
    definition: 'Venta activa (no reembolsada ni cancelada) — la unidad de negocio cerrado.',
    formula: "sales.status IN ('active','partial_refund') — ver isActiveSale() en lib/analytics.ts.",
    source: 'sales',
    notes: 'Nunca cuentes sales.status = "refunded"/"cancelled"/"chargeback" como venta activa.',
  },
  revenue: {
    name: 'Ingresos (Revenue)',
    definition: 'Suma del importe bruto de las ventas activas del periodo.',
    formula: 'SUM(sales.gross_amount) WHERE isActiveSale(sales)',
    source: 'sales.gross_amount',
  },
  cash_collected: {
    name: 'Cash Collected',
    definition: 'Dinero efectivamente cobrado (no facturado/pactado) en el periodo.',
    formula: 'SUM(collections.gross_amount) WHERE collections.is_confirmed',
    source: 'collections.gross_amount',
  },
  refund: {
    name: 'Reembolso',
    definition: 'Venta previamente activa que se devolvió total o parcialmente.',
    formula: "sales.status IN ('refunded','partial_refund')",
    source: 'sales.status',
  },
  cac: {
    name: 'CAC (Coste de Adquisición de Cliente)',
    definition: 'Cuánto cuesta en publicidad conseguir UN cliente que compra (no un lead).',
    formula: 'inversión en ads del periodo / nº de ventas activas del mismo periodo. Igual a CPA en lib/ads/funnel.ts.',
    source: 'campaigns.adspend, sales',
  },
  cpl: {
    name: 'CPL (Coste por Lead)',
    definition: 'Cuánto cuesta en publicidad conseguir UN lead.',
    formula: 'inversión en ads del periodo / nº de leads (meta_leads) del mismo periodo.',
    source: 'campaigns.adspend, campaigns.meta_leads',
  },
  cost_per_booking: {
    name: 'Coste por Agenda',
    definition: 'Cuánto cuesta en publicidad conseguir UNA cita agendada.',
    formula: 'inversión en ads del periodo / nº de agendas del mismo periodo.',
    source: 'campaigns.adspend, appointments',
  },
  show_rate: {
    name: 'Show Rate',
    definition: '% de citas agendadas a las que el lead realmente asiste.',
    formula: 'shows / agendas × 100',
    source: 'appointments.status',
  },
  close_rate: {
    name: 'Close Rate',
    definition: '% de llamadas/reuniones atendidas que terminan en venta.',
    formula: 'cierres / llamadas atendidas × 100',
    source: 'sales, appointments',
  },
  lead_to_sale_rate: {
    name: 'Lead-to-Sale Rate',
    definition: '% de leads que terminan comprando (todo el funnel de golpe).',
    formula: 'ventas activas / leads × 100',
    source: 'sales, contacts',
  },
  roas: {
    name: 'ROAS (Return on Ad Spend)',
    definition: 'Cuántos euros de facturación genera cada euro invertido en ads.',
    formula: 'facturación atribuida a ads / inversión en ads (ver computeAdFunnel en lib/ads/funnel.ts)',
    source: 'campaigns.sales_revenue, campaigns.adspend',
  },
  ltv: {
    name: 'LTV (Lifetime Value)',
    definition: 'Ingreso total esperado/generado por un cliente durante toda su relación con el negocio.',
    formula: 'Suma de todos los cobros (collections) de un contacto a lo largo del tiempo.',
    source: 'collections, sales',
    notes: 'No confundir con el ticket de una sola venta.',
  },
}

export function getMetricDefinition(key: string): MetricDefinition | null {
  const k = key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  return METRIC_REGISTRY[k] || null
}

export function listMetricNames(): string[] {
  return Object.values(METRIC_REGISTRY).map((m) => m.name)
}
