import type { CompanyProfile } from './company'
import { ID_DOC_TYPES, idDocLabel, validateIdDocument, type IdDocType } from './id-validation'
import { formatNumber } from '@/lib/utils'

// Condiciones económicas de un contrato de ALUMNO (a diferencia del de equipo,
// que va de sueldo/comisiones). Se guardan en contracts.terms y se muestran en
// la página de firma y en el PDF.
export type StudentContractTerms = {
  product_name: string
  duration_months: number | null
  gross_amount: number
  currency: string
  payment_method: string | null // stripe | transferencia | sequra | autofinanciado | reserva | custom
  plan_name: string | null
  installments_count: number | null
  // Desglose del plan personalizado (si aplica): entrada + resto.
  custom?: {
    total: number
    down_payment: number
    rest_method: string | null
    rest_installments: number | null
    notes: string | null
  } | null
  extra_notes?: string | null
}

// Datos que el alumno completa al firmar.
export type StudentSignerData = {
  id_type?: IdDocType | null
  dni?: string | null
  id_country?: string | null
  address?: string | null
  city?: string | null
  phone?: string | null
}

type SignerFieldType = 'text' | 'select'
export type SignerField = {
  key: keyof StudentSignerData
  label: string
  required: boolean
  type?: SignerFieldType
  options?: { value: string; label: string }[]
  placeholder?: string
}

export const STUDENT_SIGNER_FIELDS: SignerField[] = [
  { key: 'id_type', label: 'Tipo de documento', required: true, type: 'select', options: ID_DOC_TYPES },
  { key: 'dni', label: 'Nº de documento', required: true, placeholder: 'DNI / NIE / NIF / Pasaporte / Documento' },
  { key: 'id_country', label: 'País del documento', required: false, placeholder: 'Ej: USA, México, Francia' },
  { key: 'phone', label: 'Teléfono', required: true },
  { key: 'address', label: 'Dirección', required: false },
  { key: 'city', label: 'Ciudad', required: false },
]

// Validación compartida (cliente + servidor). Devuelve lista de errores legibles.
export function validateStudentSigner(sd: StudentSignerData): string[] {
  const errors: string[] = []
  const isInternational = sd.id_type === 'otro'
  for (const f of STUDENT_SIGNER_FIELDS) {
    const val = String(sd[f.key] ?? '').trim()
    // id_country es requerido solo si id_type === 'otro'
    if (f.key === 'id_country' && isInternational && !val) {
      errors.push(`Falta: ${f.label}`)
    } else if (f.required && f.key !== 'id_country' && !val) {
      errors.push(`Falta: ${f.label}`)
    }
  }
  const docErr = validateIdDocument(sd.id_type, String(sd.dni ?? ''))
  if (docErr) errors.push(docErr)
  return errors
}

export const DEFAULT_STUDENT_WELCOME =
  '¡Bienvenido/a! 🎉 Estás a un clic de entrar. Revisa y acepta las condiciones para recibir tus accesos al instante.'

const fmtEur = (n: number) => formatNumber(n, { minimumFractionDigits: 0, maximumFractionDigits: 2 })

function durationLabel(months: number | null): string {
  if (!months) return 'la indicada en el programa'
  if (months === 12) return '12 meses (1 año)'
  return `${months} meses`
}

function methodLabel(method: string | null): string {
  switch (method) {
    case 'stripe':
      return 'Pago con tarjeta (Stripe)'
    case 'transferencia':
      return 'Transferencia bancaria'
    case 'sequra':
      return 'Financiación con Sequra'
    case 'autofinanciado':
      return 'Pago autofinanciado a plazos'
    case 'reserva':
      return 'Reserva'
    case 'custom':
      return 'Plan de pago personalizado'
    default:
      return method ?? '—'
  }
}

// Reutiliza applyVars/stripRemainingVars del módulo de equipo (mismo motor {{...}}).
// Variables conocidas al GENERAR el contrato de alumno (empresa + alumno + condiciones).
// Las del firmante (dni, direccion…) se dejan como placeholder para la 2ª pasada.
export function studentGenerationVars(
  company: CompanyProfile,
  ctx: { fullName: string; email: string | null; terms: StudentContractTerms; dateStr: string }
): Record<string, string> {
  const t = ctx.terms
  return {
    empresa: company.legal_name || company.name,
    empresa_nombre: company.name,
    cif: company.cif ?? '',
    empresa_direccion: [company.address, company.postal_code, company.city].filter(Boolean).join(', '),
    representante: company.representative ?? '',
    nombre: ctx.fullName,
    email: ctx.email ?? '',
    producto: t.product_name,
    duracion: durationLabel(t.duration_months),
    importe: `${fmtEur(t.gross_amount)} ${t.currency}`,
    forma_pago: methodLabel(t.payment_method),
    plan: t.plan_name ?? methodLabel(t.payment_method),
    fecha: ctx.dateStr,
  }
}

// Variables que aporta el alumno al firmar (2ª pasada).
export function studentSignerVars(s: StudentSignerData): Record<string, string> {
  const dir = [s.address, s.city].filter(Boolean).join(', ')
  const docLabel = idDocLabel(s.id_type)
  const documentoStr = s.dni
    ? s.id_type === 'otro' && s.id_country
      ? `${s.id_country}: ${s.dni}`
      : `${docLabel}: ${s.dni}`
    : ''
  return {
    dni: s.dni ?? '',
    tipo_documento: docLabel,
    documento: documentoStr,
    pais_documento: s.id_country ?? '',
    direccion: dir || (s.address ?? ''),
    direccion_calle: s.address ?? '',
    ciudad: s.city ?? '',
    telefono: s.phone ?? '',
  }
}

// Líneas legibles de las "CONDICIONES DEL PROGRAMA" (para PDF y vista de firma).
export function studentConditionLines(t: StudentContractTerms): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [
    { label: 'Programa', value: t.product_name },
    { label: 'Duración de acceso', value: durationLabel(t.duration_months) },
    { label: 'Importe total', value: `${fmtEur(t.gross_amount)} ${t.currency}` },
    { label: 'Forma de pago', value: methodLabel(t.payment_method) },
  ]
  if (t.custom) {
    if (t.custom.down_payment > 0)
      lines.push({ label: 'Pago inicial', value: `${fmtEur(t.custom.down_payment)} ${t.currency}` })
    const rest = Math.max(t.custom.total - t.custom.down_payment, 0)
    if (rest > 0) {
      const n = t.custom.rest_installments ?? 1
      lines.push({
        label: 'Resto',
        value: `${fmtEur(rest)} ${t.currency} — ${methodLabel(t.custom.rest_method)}${n > 1 ? ` en ${n} cuotas` : ''}`,
      })
    }
    if (t.custom.notes) lines.push({ label: 'Notas', value: t.custom.notes })
  } else if (t.installments_count && t.installments_count > 1) {
    lines.push({ label: 'Nº de pagos', value: String(t.installments_count) })
  }
  return lines
}
