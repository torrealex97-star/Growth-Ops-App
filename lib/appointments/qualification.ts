// Respuestas del formulario de cualificación (Calendly) asociado a una cita. Compartido entre
// AppointmentDetail (ficha completa) y el pipeline de seguimiento (columna "Respuestas").

export type QualificationAnswer = { q: string; a: string }
export type Qualification = {
  respuestas?: QualificationAnswer[]
  telefono?: string
  instagram?: string
  edad?: string
  situacion?: string
  ingresos?: string
  compromiso?: string
  motivo?: string
  inversion?: string
  confirma_asistencia?: string
  vio_vsl?: string
  [key: string]: unknown
}

export const QUALIFICATION_LABELS: Record<string, string> = {
  telefono: 'Teléfono',
  instagram: 'Instagram',
  edad: 'Edad',
  situacion: 'Situación',
  ingresos: 'Ingresos/mes',
  compromiso: 'Compromiso',
  motivo: 'Motivo',
  inversion: 'Capacidad de inversión',
  confirma_asistencia: 'Confirma asistencia',
  vio_vsl: '¿Vio VSL?',
}

export function getQualificationEntries(qualification: Qualification | null | undefined): { label: string; value: string }[] {
  if (!qualification) return []
  if (qualification.respuestas?.length) {
    return qualification.respuestas
      .filter((r) => r?.a && String(r.a).trim())
      .map((r) => ({ label: r.q, value: r.a }))
  }
  return Object.entries(QUALIFICATION_LABELS)
    .map(([key, label]) => ({ label, value: qualification[key] as string | undefined }))
    .filter((e): e is { label: string; value: string } => Boolean(e.value && String(e.value).trim()))
}
