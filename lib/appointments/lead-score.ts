import type { Qualification } from '@/lib/appointments/qualification'

export type LeadScoreBand = 'cold' | 'warm' | 'hot'

const normalize = (value: unknown) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

const numericAnswer = (value: unknown): number | null => {
  const match = normalize(value).match(/\d[\d.,]*/)
  if (!match) return null

  const raw = match[0]
  const spanishThousands = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/
  const englishThousands = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/
  const normalized = spanishThousands.test(raw)
    ? raw.replace(/\./g, '').replace(',', '.')
    : englishThousands.test(raw)
      ? raw.replace(/,/g, '')
      : raw.replace(',', '.')

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Score explicable a partir del formulario. No sustituye el score de IA de la llamada:
 * sirve antes de que exista una conversación analizada.
 */
export function qualificationLeadScore(qualification: Qualification | null | undefined): number | null {
  if (!qualification) return null
  const commitment = numericAnswer(qualification.compromiso)
  const income = numericAnswer(qualification.ingresos)
  const investment = numericAnswer(qualification.inversion)
  const attendance = normalize(qualification.confirma_asistencia)
  const watched = normalize(qualification.vio_vsl)
  const situation = normalize(qualification.situacion)

  let score = 0
  let signals = 0

  if (commitment !== null) {
    score += Math.min(10, commitment) * 3
    signals += 3
  }
  if (income !== null) {
    score += income >= 3000 ? 25 : income >= 1500 ? 18 : income >= 800 ? 10 : 4
    signals += 2.5
  }
  if (investment !== null) {
    score += investment >= 2000 ? 25 : investment >= 1000 ? 18 : investment >= 500 ? 10 : 4
    signals += 2.5
  }
  if (attendance) {
    score += /si|confirm|seguro|compromet/.test(attendance) ? 10 : 2
    signals += 1
  }
  if (watched) {
    score += /si|completo|entero/.test(watched) ? 7 : /parte|algo/.test(watched) ? 4 : 1
    signals += 0.7
  }
  if (situation) {
    score += /emple|trabaj|negocio|autonom|emprend/.test(situation) ? 3 : 1
    signals += 0.3
  }

  if (signals === 0) return null
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function appointmentLeadScore(input: {
  ai_lead_score?: number | null
  qualification?: Qualification | null
}): number | null {
  if (input.ai_lead_score !== null && input.ai_lead_score !== undefined) {
    return Math.max(0, Math.min(100, Math.round(input.ai_lead_score * 10)))
  }
  return qualificationLeadScore(input.qualification)
}

export function leadScoreBand(score: number): LeadScoreBand {
  if (score >= 70) return 'hot'
  if (score >= 40) return 'warm'
  return 'cold'
}

export const LEAD_SCORE_CLASSES: Record<LeadScoreBand, string> = {
  cold: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  warm: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  hot: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
}
