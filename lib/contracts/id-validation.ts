// Validación de documentos de identidad para la firma de contratos.
// Pensado para reutilizarse en cliente (página de firma) y servidor (endpoint de
// firma) — funciones puras, sin dependencias.

export type IdDocType = 'dni' | 'nie' | 'nif' | 'pasaporte' | 'otro'

export const ID_DOC_TYPES: { value: IdDocType; label: string }[] = [
  { value: 'dni', label: 'DNI' },
  { value: 'nie', label: 'NIE' },
  { value: 'nif', label: 'NIF (empresa)' },
  { value: 'pasaporte', label: 'Pasaporte' },
  { value: 'otro', label: 'Otro (internacional)' },
]

export function idDocLabel(type: string | null | undefined): string {
  return ID_DOC_TYPES.find((t) => t.value === type)?.label ?? 'Documento'
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'

// Normaliza: mayúsculas y sin espacios/guiones.
function normalizeId(value: string): string {
  return (value || '').toUpperCase().replace(/[\s-]/g, '')
}

export function isValidDni(value: string): boolean {
  const v = normalizeId(value)
  const m = v.match(/^(\d{8})([A-Z])$/)
  if (!m) return false
  return DNI_LETTERS[Number(m[1]) % 23] === m[2]
}

export function isValidNie(value: string): boolean {
  const v = normalizeId(value)
  const m = v.match(/^([XYZ])(\d{7})([A-Z])$/)
  if (!m) return false
  const prefix = { X: '0', Y: '1', Z: '2' }[m[1]]!
  return DNI_LETTERS[Number(prefix + m[2]) % 23] === m[3]
}

// CIF/NIF de empresa: letra inicial + 7 dígitos + dígito/letra de control.
function isValidNif(value: string): boolean {
  const v = normalizeId(value)
  const m = v.match(/^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/)
  if (!m) return false
  const digits = m[2]
  let sumA = 0
  let sumB = 0
  for (let i = 0; i < digits.length; i++) {
    const n = Number(digits[i])
    if (i % 2 === 0) {
      const d = n * 2
      sumB += Math.floor(d / 10) + (d % 10)
    } else {
      sumA += n
    }
  }
  const total = sumA + sumB
  const control = (10 - (total % 10)) % 10
  const provided = m[3]
  // Según la letra inicial el control es número o letra; aceptamos ambos.
  const controlLetter = 'JABCDEFGHI'[control]
  return provided === String(control) || provided === controlLetter
}

// Pasaporte: sin estándar único; alfanumérico razonable (5-20).
function isValidPassport(value: string): boolean {
  const v = normalizeId(value)
  return /^[A-Z0-9]{5,20}$/.test(v)
}

// Devuelve null si es válido, o un mensaje de error si no.
export function validateIdDocument(type: string | null | undefined, value: string): string | null {
  const v = (value || '').trim()
  if (!v) return null // la obligatoriedad se controla aparte
  switch (type) {
    case 'dni':
      return isValidDni(v) ? null : 'El DNI no es válido (8 números + letra de control).'
    case 'nie':
      return isValidNie(v) ? null : 'El NIE no es válido (X/Y/Z + 7 números + letra).'
    case 'nif':
      return isValidNif(v) ? null : 'El NIF de empresa no es válido.'
    case 'pasaporte':
      return isValidPassport(v) ? null : 'El pasaporte no es válido (5-20 caracteres alfanuméricos).'
    case 'otro':
      // Documentos internacionales: solo requiere al menos 2 caracteres, sin validación específica por país
      return v.length >= 2 ? null : 'El documento debe tener al menos 2 caracteres.'
    default:
      // Sin tipo declarado: intenta DNI o NIE como cortesía.
      return isValidDni(v) || isValidNie(v) ? null : 'El documento de identidad no es válido.'
  }
}
