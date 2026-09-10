import type { CommissionRule, User } from '@/lib/types/database'
import type { CompanyProfile } from './company'

// Condiciones económicas de un contrato de equipo, extraídas de la plataforma
// (sueldo fijo del miembro + reglas de comisión por tramos) y confirmables/editables
// antes de enviar el contrato a firmar.
export type CommissionTier = {
  participant_type: string
  label: string | null
  min_cash: number
  max_cash: number | null
  percent: number
}

export type ContractTerms = {
  fixed_salary: number | null       // €/mes (User.base_salary)
  currency: string
  commissions: CommissionTier[]      // tramos aplicables al rol elegido
  affiliate_percent: number | null   // solo afiliados (User.default_affiliate_commission_percent)
  role_key: string | null
  role_label: string | null
  extra_notes: string | null
  personal_email?: string | null    // correo personal del colaborador (recibe copia del contrato)
}

// Datos que el firmante completa al firmar (los que falten). Todos opcionales
// en el tipo; la UI marca cuáles pedir.
export type SignerData = {
  dni?: string | null
  address?: string | null
  postal_code?: string | null
  city?: string | null
  phone?: string | null
}

// Campos que puede/deber completar el firmante en la página de firma.
export const SIGNER_FIELDS: { key: keyof SignerData; label: string; required: boolean }[] = [
  { key: 'dni', label: 'DNI / NIE', required: true },
  { key: 'address', label: 'Dirección', required: true },
  { key: 'postal_code', label: 'Código postal', required: true },
  { key: 'city', label: 'Ciudad', required: true },
  { key: 'phone', label: 'Teléfono', required: false },
]

// Mapea un rol al participant_type de las reglas de comisión.
export function participantTypeForRole(roleKey?: string | null): string | null {
  if (roleKey === 'setter') return 'setter'
  if (roleKey === 'closer') return 'closer'
  if (roleKey === 'affiliate') return 'affiliate'
  return null
}

// Construye las condiciones por defecto leyendo la plataforma:
//  · fijo   = users.base_salary
//  · tramos = commission_rules activas del participant_type del ROL ELEGIDO,
//             priorizando las específicas del rep (user_id) sobre las genéricas.
export function buildDefaultTerms(
  user: Pick<User, 'id' | 'base_salary' | 'default_affiliate_commission_percent'>,
  roleKey: string | null,
  roleLabel: string | null,
  rules: CommissionRule[]
): ContractTerms {
  const pt = participantTypeForRole(roleKey)
  let commissions: CommissionTier[] = []

  if (pt) {
    const active = rules.filter((r) => r.participant_type === pt && r.is_active)
    const scoped = active.filter((r) => r.user_id === user.id)
    const pool = scoped.length ? scoped : active.filter((r) => !r.user_id)
    commissions = pool
      .slice()
      .sort((a, b) => (a.min_cash ?? 0) - (b.min_cash ?? 0))
      .map((r) => ({
        participant_type: r.participant_type,
        label: r.label,
        min_cash: r.min_cash ?? 0,
        max_cash: r.max_cash,
        percent: r.percent,
      }))
  }

  return {
    fixed_salary: user.base_salary ?? null,
    currency: 'EUR',
    commissions,
    affiliate_percent: pt === 'affiliate' ? user.default_affiliate_commission_percent ?? null : null,
    role_key: roleKey ?? null,
    role_label: roleLabel ?? null,
    extra_notes: null,
  }
}

const fmtEur = (n: number) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n)

// Texto legible de un tramo de comisión.
export function tierLine(t: CommissionTier): string {
  const range =
    t.max_cash != null
      ? `${fmtEur(t.min_cash)} - ${fmtEur(t.max_cash)} EUR`
      : `${fmtEur(t.min_cash)} EUR+`
  const label = t.label ? ` (${t.label})` : ''
  return `${range}${label}  ->  ${t.percent}%`
}

// Sustituye SOLO las variables {{...}} presentes en `vars`; deja intactas las
// demás (p.ej. las que rellena el firmante más tarde). Case-insensitive.
export function applyVars(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) =>
    key in vars ? vars[key] : m
  )
}

// Variables conocidas en el momento de GENERAR el contrato (empresa + miembro).
// Las que rellena el firmante (dni, direccion, telefono…) se dejan como placeholder
// para la 2ª pasada al firmar — NO se resuelven aquí (si no, se quedarían vacías
// aunque el firmante las rellene después).
export function generationVars(
  company: CompanyProfile,
  ctx: { fullName: string; email: string | null; personalEmail?: string | null; roleLabel: string | null; startDate: string; fixedSalary: number | null }
): Record<string, string> {
  const fijo = ctx.fixedSalary != null ? `${fmtEur(ctx.fixedSalary)} EUR/mes` : 'sin retribución fija'
  return {
    empresa: company.legal_name || company.name,
    empresa_nombre: company.name,
    cif: company.cif ?? '',
    empresa_direccion: [company.address, company.postal_code, company.city].filter(Boolean).join(', '),
    representante: company.representative ?? '',
    nombre: ctx.fullName,
    email: ctx.email ?? '',
    email_personal: ctx.personalEmail ?? '',
    correo_personal: ctx.personalEmail ?? '',
    rol: ctx.roleLabel ?? 'Colaborador',
    fecha: ctx.startDate,
    fijo,
  }
}

// Variables que aporta el firmante al firmar (para la 2ª pasada de sustitución).
export function signerVars(s: SignerData): Record<string, string> {
  const dir = [s.address, s.postal_code, s.city].filter(Boolean).join(', ')
  return {
    dni: s.dni ?? '',
    direccion: dir || (s.address ?? ''),
    direccion_calle: s.address ?? '',
    codigo_postal: s.postal_code ?? '',
    ciudad: s.city ?? '',
    telefono: s.phone ?? '',
  }
}

// Reemplaza cualquier variable {{...}} restante (no rellenada) por una línea
// para completar, para que el PDF final no muestre las llaves.
export function stripRemainingVars(body: string): string {
  return body.replace(/\{\{\s*\w+\s*\}\}/g, '__________')
}
