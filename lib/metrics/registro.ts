// EL REGISTRO DE MÉTRICAS. Una sola definición por métrica, para toda la aplicación.
//
// EL ORDEN ES LA TESIS. Las métricas finales del negocio van primero y las de diagnóstico después:
//
//   Revenue / Cash / LTGP:CAC
//     -> CAC / Ventas / Close Rate
//       -> Agendas cualificadas / CPQBC / Show Rate
//         -> Agendas / Leads / conversión del funnel
//           -> Clics / CPC / CTR / CPM
//
// CPM, CTR, CPC, visitas y seguidores NUNCA se presentan como objetivo del negocio. Son el último
// escalón: sirven para explicar por qué se mueve el de arriba, no para decidir si el mes va bien. Un
// panel que abre con el CTR invita a optimizar el CTR, que es exactamente cómo se acaba con anuncios
// muy clicados que no venden.
//
// LOS OBJETIVOS SON DECLARACIONES DE NEGOCIO, no verdades del sector. Los que llevan número aquí son
// los que el negocio ha fijado explícitamente; el resto van con `targetType: 'ninguno'` y se muestran
// sin semáforo. Inventar un benchmark leído por ahí y pintar rojo con él sería peor que no juzgar.

import type { DefinicionMetrica } from '@/lib/metrics/modelo'

const M = (d: DefinicionMetrica) => d

// =================================================================================================
// 1. GLOBAL / NEGOCIO — lo que de verdad dice si el negocio va bien.
// =================================================================================================

export const METRICAS_GLOBAL: DefinicionMetrica[] = [
  M({
    id: 'global.cash_collected',
    key: 'cash_collected',
    name: 'Cash Collected',
    shortName: 'Cash',
    category: 'global',
    subcategory: 'cash',
    unit: 'eur',
    formula: 'Suma de los cobros confirmados en el periodo',
    description: 'El dinero que de verdad ha entrado en las cuentas durante el periodo.',
    whyItMatters:
      'Es lo único que paga nóminas y anuncios. Una venta firmada que aún no se ha cobrado no sirve para pagar nada.',
    dataSource: 'Cobros confirmados (Stripe / pasarela de pago)',
    fallbackDataSource: 'Registro manual de cobros',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'barras',
    timeGranularity: ['dia', 'semana', 'mes'],
  }),
  M({
    id: 'global.contracted_revenue',
    key: 'contracted_revenue',
    name: 'Facturación contratada',
    shortName: 'Facturación',
    category: 'global',
    subcategory: 'cash',
    unit: 'eur',
    formula: 'Suma del precio pactado de las ventas activas del periodo',
    description: 'Lo que los clientes se han comprometido a pagar, cobrado o no.',
    whyItMatters:
      'Mide lo que se ha vendido. Comparada con el cash collected dice cuánto dinero está pendiente de entrar.',
    dataSource: 'Ventas registradas (precio del plan contratado)',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'barras',
    timeGranularity: ['dia', 'semana', 'mes'],
  }),
  M({
    id: 'global.cash_collection_ratio',
    key: 'cash_collection_ratio',
    name: 'Ratio de cobro',
    shortName: 'Ratio cobro',
    category: 'global',
    subcategory: 'cash',
    unit: 'porcentaje',
    formula: 'Cash Collected / Facturación contratada × 100',
    description: 'Qué parte de lo vendido ya está cobrada.',
    whyItMatters:
      'Un ratio que baja avisa de que se está vendiendo a plazos más largos o de que hay impagos, antes de que se note en la caja.',
    dataSource: 'Cobros y ventas',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['semana', 'mes'],
    calculationDependencies: ['cash_collected', 'contracted_revenue'],
  }),
  M({
    id: 'global.cash_roas',
    key: 'cash_roas',
    name: 'Cash ROAS',
    shortName: 'Cash ROAS',
    category: 'global',
    unit: 'ratio',
    formula: 'Cash cobrado de clientes captados por anuncios / Inversión publicitaria',
    description:
      'Cuánto dinero efectivamente cobrado genera cada euro invertido en anuncios, contando solo a los clientes que vinieron por ahí.',
    whyItMatters:
      'Dice si la captación se está pagando sola en dinero real, no en ventas firmadas que aún no han entrado.',
    dataSource: 'Cobros confirmados + inversión de la plataforma + atribución del CRM',
    higherIsBetter: true,
    targetType: 'minimo',
    target: 2,
    recommendedChart: 'linea',
    timeGranularity: ['semana', 'mes'],
    calculationDependencies: ['cash_collected', 'ad_spend'],
  }),
  M({
    id: 'global.ltgp_cac',
    key: 'ltgp_cac',
    name: 'LTGP : CAC',
    shortName: 'LTGP:CAC',
    category: 'global',
    unit: 'ratio',
    formula: 'Beneficio bruto de por vida por cliente / Coste de adquirir un cliente',
    description: 'Cuántos euros de margen deja un cliente por cada euro que cuesta conseguirlo.',
    whyItMatters:
      'Es la métrica que decide si se puede escalar. Por debajo de 3 el crecimiento consume caja en vez de generarla.',
    dataSource: 'Cobros por cliente + inversión publicitaria + atribución',
    higherIsBetter: true,
    targetType: 'minimo',
    target: 3,
    recommendedChart: 'linea',
    timeGranularity: ['mes'],
    calculationDependencies: ['cash_collected', 'cac'],
  }),
]

// =================================================================================================
// 2. VENTAS — la cadena diagnóstica del equipo comercial.
// =================================================================================================

export const METRICAS_SALES: DefinicionMetrica[] = [
  M({
    id: 'sales.ventas',
    key: 'ventas',
    name: 'Ventas',
    shortName: 'Ventas',
    category: 'sales',
    unit: 'numero',
    formula: 'Número de ventas activas con fecha en el periodo',
    description: 'Cuántas ventas se han cerrado.',
    whyItMatters: 'Es el resultado del equipo comercial, y el numerador de casi todas sus tasas.',
    dataSource: 'Ventas registradas',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'barras',
    timeGranularity: ['dia', 'semana', 'mes'],
  }),
  M({
    id: 'sales.cac',
    key: 'cac',
    name: 'CAC',
    shortName: 'CAC',
    category: 'sales',
    unit: 'eur',
    formula: 'Inversión publicitaria del periodo / Ventas del periodo',
    description: 'Cuánto cuesta en publicidad conseguir un cliente que compra.',
    whyItMatters: 'Comparado con lo que deja cada cliente, dice si se puede invertir más mañana sin perder dinero.',
    dataSource: 'Inversión de la plataforma publicitaria + ventas',
    // MÁS ALTO ES PEOR. Es el ejemplo de por qué higherIsBetter no puede tener valor por defecto.
    higherIsBetter: false,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['semana', 'mes'],
    calculationDependencies: ['ad_spend', 'ventas'],
  }),
  M({
    id: 'sales.show_rate',
    key: 'show_rate',
    name: 'Show Rate',
    shortName: 'Show',
    category: 'sales',
    unit: 'porcentaje',
    formula: 'Llamadas asistidas / Agendas no canceladas × 100',
    description: 'De cada 100 llamadas agendadas que no se cancelaron, cuántas se celebraron.',
    whyItMatters: 'Cada punto que baja es tiempo de closer pagado y no usado, y dinero de captación tirado.',
    dataSource: 'Agendas del CRM (Calendly / GHL) + evidencia de llamada',
    higherIsBetter: true,
    targetType: 'rango',
    targetMin: 65,
    targetMax: 70,
    recommendedChart: 'linea',
    timeGranularity: ['semana', 'mes'],
  }),
  M({
    id: 'sales.pitch_rate',
    key: 'pitch_rate',
    name: 'Pitch Rate',
    shortName: 'Pitch',
    category: 'sales',
    unit: 'porcentaje',
    formula: 'Ofertas presentadas / Llamadas asistidas × 100',
    description: 'De cada 100 llamadas celebradas, en cuántas se llegó a presentar la oferta.',
    whyItMatters:
      'Un pitch rate bajo señala llamadas que se van sin llegar a la oferta: o el lead no encaja, o la llamada se descontrola.',
    dataSource: 'Valoración del closer en la agenda',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['semana', 'mes'],
  }),
  M({
    id: 'sales.close_rate_ofertas',
    key: 'close_rate_ofertas',
    name: 'Close Rate (sobre ofertas)',
    shortName: 'Close / ofertas',
    category: 'sales',
    unit: 'porcentaje',
    formula: 'Ventas / Ofertas presentadas × 100',
    description: 'De cada 100 personas a las que se presentó la oferta, cuántas compraron.',
    whyItMatters: 'Mide la capacidad de cierre con el lead ya delante y la oferta ya puesta encima de la mesa.',
    dataSource: 'Ventas + valoración del closer',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['semana', 'mes'],
  }),
  M({
    id: 'sales.close_rate_llamadas',
    key: 'close_rate_llamadas',
    name: 'Close Rate (sobre llamadas)',
    shortName: 'Close / llamadas',
    category: 'sales',
    unit: 'porcentaje',
    formula: 'Ventas / Llamadas asistidas × 100',
    description: 'De cada 100 llamadas celebradas, cuántas acabaron en venta.',
    // Las dos se llaman "close rate" y NO son lo mismo: sobre llamadas siempre sale más baja porque
    // incluye las que ni llegaron a la oferta. Nombrarlas igual es como se acaba comparando peras con
    // manzanas entre dos pantallas.
    whyItMatters: 'Mide el rendimiento de la llamada completa, incluidas las que no llegaron a la oferta.',
    dataSource: 'Ventas + agendas',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['semana', 'mes'],
  }),
  M({
    id: 'sales.aov',
    key: 'aov',
    name: 'Ticket medio',
    shortName: 'Ticket',
    category: 'sales',
    unit: 'eur',
    formula: 'Facturación contratada / Ventas',
    description: 'Lo que vale de media cada venta, al precio pactado.',
    whyItMatters: 'Subirlo mejora todas las métricas de abajo sin necesidad de más leads ni más llamadas.',
    // Se calcula sobre lo CONTRATADO, no sobre lo cobrado: con planes a plazos, lo cobrado dividiría
    // por ventas cuyo dinero aún no ha entrado y daría un ticket que no corresponde a ningún precio real.
    dataSource: 'Ventas (precio del plan contratado)',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'barras',
    timeGranularity: ['semana', 'mes'],
    calculationDependencies: ['contracted_revenue', 'ventas'],
  }),
  M({
    id: 'sales.speed_to_lead',
    key: 'speed_to_lead',
    name: 'Speed to Lead',
    shortName: 'Speed to lead',
    category: 'sales',
    unit: 'minutos',
    formula: 'Mediana de (primer contacto humano − creación del lead)',
    description: 'Cuánto se tarda de media en que una persona del equipo contacte a un lead nuevo.',
    whyItMatters: 'La probabilidad de contactar cae en picado pasados los primeros minutos.',
    dataSource: 'Conversaciones de setting + creación del contacto',
    // MEDIANA, no media: un lead contactado tres días después arrastra la media y esconde que el resto
    // se atendieron en minutos.
    higherIsBetter: false,
    targetType: 'maximo',
    target: 5,
    recommendedChart: 'linea',
    timeGranularity: ['dia', 'semana'],
  }),
  M({
    id: 'sales.bamfam_rate',
    key: 'bamfam_rate',
    name: 'BAMFAM',
    shortName: 'BAMFAM',
    category: 'sales',
    unit: 'porcentaje',
    formula: 'Llamadas asistidas sin venta con siguiente reunión agendada / Llamadas asistidas sin venta × 100',
    description: 'De las llamadas que no cerraron, en cuántas se dejó ya agendada la siguiente.',
    whyItMatters:
      'Sin siguiente reunión agendada, la mayoría de esos leads no vuelve. Es el arreglo más barato del funnel.',
    dataSource: 'Valoración del closer en la agenda',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['semana', 'mes'],
  }),
]

// =================================================================================================
// 3. MARKETING — de lo cualificado a lo diagnóstico, en ese orden.
// =================================================================================================

export const METRICAS_MARKETING: DefinicionMetrica[] = [
  M({
    id: 'marketing.agendas',
    key: 'agendas',
    name: 'Agendas',
    shortName: 'Agendas',
    category: 'marketing',
    unit: 'numero',
    formula: 'Número de reuniones agendadas en el periodo',
    description: 'Cuántas llamadas se han reservado.',
    whyItMatters: 'Es el volumen que alimenta a todo el equipo comercial.',
    dataSource: 'Calendly / GHL',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'barras',
    timeGranularity: ['dia', 'semana', 'mes'],
  }),
  M({
    id: 'marketing.agendas_cualificadas',
    key: 'agendas_cualificadas',
    name: 'Agendas cualificadas',
    shortName: 'Cualificadas',
    category: 'marketing',
    unit: 'numero',
    formula: 'Agendas cuyas respuestas del formulario declaran el problema y ingresos por encima del umbral',
    description: 'Las reservas que, por lo que contestaron en el formulario, encajan con lo que el negocio resuelve.',
    // Es de MARKETING. El prospecto cualificado (juicio del closer) es otra métrica, de ventas.
    whyItMatters:
      'Es de lo que responde marketing. Traer muchas agendas que no cualifican quema tiempo de closer sin generar negocio.',
    dataSource: 'Respuestas del formulario de Calendly / GHL / Typeform',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'barras',
    timeGranularity: ['dia', 'semana', 'mes'],
  }),
  M({
    id: 'marketing.cpqbc',
    key: 'cpqbc',
    name: 'Coste por agenda cualificada',
    shortName: 'CPQBC',
    category: 'marketing',
    unit: 'eur',
    formula: 'Inversión publicitaria / Agendas cualificadas',
    description: 'Cuánto cuesta conseguir una reserva que además encaja con el cliente ideal.',
    whyItMatters: 'El coste por agenda a secas engaña: se puede bajar trayendo gente que no puede comprar. Este no.',
    dataSource: 'Inversión de la plataforma + cualificación del formulario',
    higherIsBetter: false,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['semana', 'mes'],
    calculationDependencies: ['ad_spend', 'agendas_cualificadas'],
  }),
  M({
    id: 'marketing.tasa_concordancia',
    key: 'tasa_concordancia_cualificacion',
    name: 'Acuerdo marketing ↔ ventas',
    shortName: 'Acuerdo cualif.',
    category: 'marketing',
    unit: 'porcentaje',
    formula: 'Agendas donde formulario y closer coinciden / Agendas donde ambos se pronunciaron × 100',
    description: 'Con qué frecuencia el filtro del formulario acierta, según lo que ve el closer en la llamada.',
    whyItMatters:
      'Si baja, el formulario no está filtrando: se traen agendas que parecen buenas y no lo son. El problema es el lead, no el closer.',
    dataSource: 'Respuestas del formulario + valoración del closer',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['semana', 'mes'],
  }),
  M({
    id: 'marketing.ad_spend',
    key: 'ad_spend',
    name: 'Inversión publicitaria',
    shortName: 'Inversión',
    category: 'marketing',
    subcategory: 'paid_meta',
    unit: 'eur',
    formula: 'Suma del gasto de las campañas en el periodo',
    description: 'Lo gastado en anuncios.',
    whyItMatters: 'Es el denominador de casi todas las métricas de eficiencia de captación.',
    dataSource: 'API de Meta Ads',
    fallbackDataSource: 'Importación manual desde Meta',
    // Gastar más no es ni bueno ni malo por sí solo: depende de lo que devuelva. Sin objetivo y sin
    // semáforo, para no premiar ni castigar el gasto en abstracto.
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'barras',
    timeGranularity: ['dia', 'semana', 'mes'],
  }),
]

// =================================================================================================
// 4. DIAGNÓSTICO — el último escalón. Explican, no deciden.
// =================================================================================================

export const METRICAS_DIAGNOSTICO: DefinicionMetrica[] = [
  M({
    id: 'marketing.ctr',
    key: 'ctr',
    name: 'CTR',
    shortName: 'CTR',
    category: 'marketing',
    subcategory: 'paid_meta',
    unit: 'porcentaje',
    formula: 'Clics / Impresiones × 100',
    description: 'De cada 100 veces que se muestra el anuncio, cuántas se hace clic.',
    whyItMatters:
      'Sirve para diagnosticar el creativo cuando el coste por agenda sube. NO es un objetivo: un anuncio muy clicado que no vende es un anuncio caro.',
    dataSource: 'API de Meta Ads',
    higherIsBetter: true,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['dia', 'semana'],
  }),
  M({
    id: 'marketing.cpc',
    key: 'cpc',
    name: 'CPC',
    shortName: 'CPC',
    category: 'marketing',
    subcategory: 'paid_meta',
    unit: 'eur',
    formula: 'Inversión / Clics',
    description: 'Lo que cuesta cada clic.',
    whyItMatters: 'Explica movimientos del coste por agenda. Por sí solo no dice si el negocio gana dinero.',
    dataSource: 'API de Meta Ads',
    higherIsBetter: false,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['dia', 'semana'],
  }),
  M({
    id: 'marketing.cpm',
    key: 'cpm',
    name: 'CPM',
    shortName: 'CPM',
    category: 'marketing',
    subcategory: 'paid_meta',
    unit: 'eur',
    formula: 'Inversión / Impresiones × 1000',
    description: 'Lo que cuesta mostrar el anuncio mil veces.',
    whyItMatters: 'Señala saturación de audiencia o subida de la competencia. Es contexto, nunca un objetivo.',
    dataSource: 'API de Meta Ads',
    higherIsBetter: false,
    targetType: 'ninguno',
    recommendedChart: 'linea',
    timeGranularity: ['dia', 'semana'],
  }),
]

/**
 * Todas, EN ORDEN DE JERARQUÍA. Quien recorra esta lista para pintar un panel obtiene lo final
 * primero y el diagnóstico al final, sin tener que acordarse de ordenarlo.
 */
export const TODAS_LAS_METRICAS: DefinicionMetrica[] = [
  ...METRICAS_GLOBAL,
  ...METRICAS_SALES,
  ...METRICAS_MARKETING,
  ...METRICAS_DIAGNOSTICO,
]

/** Las de diagnóstico, para poder separarlas visualmente de las que sí deciden. */
export const KEYS_DIAGNOSTICO = new Set(METRICAS_DIAGNOSTICO.map((m) => m.key))

export function buscarMetrica(key: string): DefinicionMetrica | undefined {
  return TODAS_LAS_METRICAS.find((m) => m.key === key)
}
