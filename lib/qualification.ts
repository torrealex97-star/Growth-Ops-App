// Etiquetas y utilidades para las respuestas del formulario (cualificación del lead).
// Fuente única compartida por el webhook, Atribución, Dashboard y detalle de contacto.

export function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function slugify(s: string): string {
  return norm(s)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

// Mapea el texto de una pregunta de formulario a una clave de cualificación conocida (o null).
// Usada por el webhook de Calendly para guardar `qualification`, y por `lib/calendly.ts`
// para poder reenviar respuestas REALES (en vez de placeholders) al reagendar una cita.
export function mapKey(q: string): string | null {
  const s = norm(q)
  if (/telefono|whatsapp|numero de tel/.test(s)) return 'telefono'
  if (/instagram/.test(s)) return 'instagram'
  if (/\bedad\b|anos|años|que edad/.test(s)) return 'edad'
  if (/se ajusta mejor|situacion|ocupacion|estudiante|emprend/.test(s)) return 'situacion'
  if (/generando al mes|estas ganando|ingresos|cuanto estas generando/.test(s)) return 'ingresos'
  if (/escala del 1 al 10|comprometido|compromiso/.test(s)) return 'compromiso'
  if (/motivo real|motivo|por que|razon/.test(s)) return 'motivo'
  if (/invertir|capaz de invertir|inversion/.test(s)) return 'inversion'
  if (/presentarte|confirmas|puedes presentarte|faltes a la reunion/.test(s)) return 'confirma_asistencia'
  if (/vsl|entrenamiento gratuito|visto nuestro/.test(s)) return 'vio_vsl'
  return null
}

export type QualificationAnswer = { q: string; a: string }
export type Qualification = {
  respuestas?: QualificationAnswer[]
  [key: string]: unknown
}

// Preguntas clave que resumen la calidad del lead (orden de visualización).
export const QUALIFICATION_KEYS = [
  'situacion',
  'ingresos',
  'compromiso',
  'inversion',
  'motivo',
  'confirma_asistencia',
  'vio_vsl',
] as const

export type QualificationKey = (typeof QUALIFICATION_KEYS)[number]

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

export function labelFor(key: string): string {
  return QUALIFICATION_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Devuelve el valor de una clave, cayendo al array `respuestas` si no está mapeada.
export function answerFor(q: Qualification | null | undefined, key: string): string | null {
  if (!q) return null
  const direct = q[key]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  return null
}

// ¿Tiene respuestas útiles?
export function hasAnswers(q: Qualification | null | undefined): boolean {
  return !!q && Array.isArray(q.respuestas) && q.respuestas.length > 0
}
