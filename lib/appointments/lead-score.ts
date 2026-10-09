import type { AppointmentWithRelations } from '@/lib/types/database'
import { getQualificationAnswers, type Qualification } from '@/lib/appointments/qualification'
import { evaluarLeadScore } from '@/lib/metrics/cualificacion'
import { extraerRespuestas } from '@/lib/metrics/respuestas-formulario'

/**
 * Fuente única del score previo a la llamada. Prefiere la columna normalizada y conserva soporte
 * para el histórico que todavía guarda el formulario exclusivamente en `raw_payload`.
 */
export function appointmentLeadScore(
  appointment: Pick<AppointmentWithRelations, 'qualification' | 'raw_payload' | 'external_source'>
) {
  const normalized = getQualificationAnswers(appointment.qualification as Qualification | null)
  const answers = normalized.length
    ? normalized
    : extraerRespuestas(appointment.raw_payload, appointment.external_source)

  return evaluarLeadScore(answers)
}
