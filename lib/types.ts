export interface Lead {
  id: string
  fechaRegistro: string
  nombre: string
  telefono: string
  email: string
  avatar: string
  fuente: string
  afiliado: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmContent: string
  utmTerm: string
  etiqueta: string
  whatsappRegistro: string
  encuestaRellenada: boolean
  // Survey answers
  q0Edad: string
  q1Fuente: string
  q2Ocupacion: string
  q3Economia: string
  q4Objetivo: string
  q5Aprender: string
  q6Timing: string
  q7Deseo: string
}

export interface KPIStats {
  totalLeads: number
  encuestaCompletada: number
  encuestaCompletadaPct: number
  topFuente: string
  leadsHoy: number
}

export interface SurveyBreakdown {
  label: string
  count: number
  pct: number
}

export interface SurveyStats {
  edad: SurveyBreakdown[]
  fuente: SurveyBreakdown[]
  ocupacion: SurveyBreakdown[]
  economia: SurveyBreakdown[]
  objetivo: SurveyBreakdown[]
  aprender: SurveyBreakdown[]
  timing: SurveyBreakdown[]
}

export interface UTMCampaignStat {
  campaign: string
  content: string
  term: string
  totalLeads: number
  encuestaCount: number
  encuestaPct: number
  score: number
}

export interface UTMStats {
  bySource: SurveyBreakdown[]
  byCampaign: UTMCampaignStat[]
  byAd: SurveyBreakdown[]
}

export interface AfiliadaStat {
  email: string
  nombre: string
  leads: number
  pct: number
}

export interface AfiliadasStats {
  totalLeadsAfiliadas: number
  pctOfTotal: number
  ranking: AfiliadaStat[]
}

export interface WhatsAppMsgStats {
  enviados: number       // enviado = sent AND interacted
  timeout: number        // timeout = sent but no interaction
  fallidos: number       // fallido = failed to send
  pendientes: number     // not yet attempted
  totalContactados: number  // enviados + timeout + fallidos
  totalEntregados: number   // enviados + timeout (actually delivered)
  tasaEntrega: number    // % delivered out of all attempted
  tasaInteraccion: number // % who interacted out of delivered
  pctLeadsContactados: number
}

export interface DashboardData {
  leads: Lead[]
  stats: KPIStats
  surveyStats: SurveyStats
  utmStats: UTMStats
  whatsappStats: WhatsAppMsgStats
  afiliadasStats: AfiliadasStats
  lastUpdated: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}
