// Normalización de teléfonos a E.164 para que GoHighLevel NO asuma prefijo +1 (EE.UU.)
// cuando el número llega sin prefijo. Se usa en los formularios (selector de prefijo)
// y como red de seguridad antes de mandar el teléfono a GHL.

export type DialCode = { code: string; iso: string; label: string }

// Prefijos habituales (España primero por ser el mercado principal).
export const DIAL_CODES: DialCode[] = [
  { code: '+34', iso: 'ES', label: '🇪🇸 España (+34)' },
  { code: '+52', iso: 'MX', label: '🇲🇽 México (+52)' },
  { code: '+54', iso: 'AR', label: '🇦🇷 Argentina (+54)' },
  { code: '+57', iso: 'CO', label: '🇨🇴 Colombia (+57)' },
  { code: '+56', iso: 'CL', label: '🇨🇱 Chile (+56)' },
  { code: '+51', iso: 'PE', label: '🇵🇪 Perú (+51)' },
  { code: '+58', iso: 'VE', label: '🇻🇪 Venezuela (+58)' },
  { code: '+593', iso: 'EC', label: '🇪🇨 Ecuador (+593)' },
  { code: '+598', iso: 'UY', label: '🇺🇾 Uruguay (+598)' },
  { code: '+595', iso: 'PY', label: '🇵🇾 Paraguay (+595)' },
  { code: '+591', iso: 'BO', label: '🇧🇴 Bolivia (+591)' },
  { code: '+502', iso: 'GT', label: '🇬🇹 Guatemala (+502)' },
  { code: '+506', iso: 'CR', label: '🇨🇷 Costa Rica (+506)' },
  { code: '+507', iso: 'PA', label: '🇵🇦 Panamá (+507)' },
  { code: '+1', iso: 'DO', label: '🇩🇴 Rep. Dominicana (+1)' },
  { code: '+504', iso: 'HN', label: '🇭🇳 Honduras (+504)' },
  { code: '+503', iso: 'SV', label: '🇸🇻 El Salvador (+503)' },
  { code: '+505', iso: 'NI', label: '🇳🇮 Nicaragua (+505)' },
  { code: '+1', iso: 'US', label: '🇺🇸 EE.UU. (+1)' },
  { code: '+351', iso: 'PT', label: '🇵🇹 Portugal (+351)' },
  { code: '+33', iso: 'FR', label: '🇫🇷 Francia (+33)' },
  { code: '+39', iso: 'IT', label: '🇮🇹 Italia (+39)' },
  { code: '+49', iso: 'DE', label: '🇩🇪 Alemania (+49)' },
  { code: '+44', iso: 'GB', label: '🇬🇧 Reino Unido (+44)' },
  { code: '+376', iso: 'AD', label: '🇦🇩 Andorra (+376)' },
]

export const DEFAULT_DIAL_CODE = '+34'

// Prefijos ordenados de más largo a más corto para detectar el correcto sin ambigüedad.
const CODES_BY_LENGTH = Array.from(new Set(DIAL_CODES.map((d) => d.code))).sort((a, b) => b.length - a.length)

// +1 lo comparten varios países NANP; DIAL_CODES solo distingue US/DO, así que desambiguamos
// por el código de área (los de Rep. Dominicana son 809/829/849 tras el "+1").
const DO_AREA_CODES = ['809', '829', '849']
function isoForSharedPlusOne(nationalDigits: string): string {
  return DO_AREA_CODES.includes(nationalDigits.slice(0, 3)) ? 'DO' : 'US'
}

export function dialCodeForCountryISO(iso: string | null | undefined): string | null {
  if (!iso) return null
  const up = iso.toUpperCase()
  return DIAL_CODES.find((d) => d.iso === up)?.code ?? null
}

// Une prefijo + número nacional en E.164 (solo dígitos tras el "+").
export function toE164(prefix: string, national: string): string {
  const nat = (national || '').replace(/\D/g, '').replace(/^0+/, '')
  if (!nat) return ''
  const pref = (prefix || DEFAULT_DIAL_CODE).replace(/[^\d+]/g, '')
  const cleanPref = pref.startsWith('+') ? pref : `+${pref}`
  return `${cleanPref}${nat}`
}

// Normaliza un teléfono que puede venir ya con prefijo, o con un prefijo elegido aparte.
// - Si `raw` ya empieza por "+", se respeta (solo se limpian separadores).
// - Si no, se le antepone `prefix` (por defecto +34).
export function normalizePhoneE164(raw: string | null | undefined, prefix?: string | null): string {
  const value = (raw || '').trim()
  if (!value) return ''
  if (value.startsWith('+')) return '+' + value.slice(1).replace(/\D/g, '')
  // 00 internacional → +
  if (value.startsWith('00')) return '+' + value.slice(2).replace(/\D/g, '')
  return toE164(prefix || DEFAULT_DIAL_CODE, value)
}

// País (ISO) a partir de un teléfono, para métricas "leads por país". Solo se fía de números que
// ya traen prefijo explícito (+ o 00) — si no, no hay señal fiable y se devuelve null en vez de
// asumir España por defecto (eso falsearía la métrica con todos los teléfonos sin prefijo).
export function countryISOForPhone(phone: string | null | undefined): string | null {
  const value = (phone || '').trim()
  if (!value) return null
  const normalized = value.startsWith('00') ? '+' + value.slice(2) : value
  if (!normalized.startsWith('+')) return null
  const digits = normalized.slice(1).replace(/\D/g, '')
  for (const code of CODES_BY_LENGTH) {
    const bare = code.slice(1)
    if (digits.startsWith(bare)) {
      if (code === '+1') return isoForSharedPlusOne(digits.slice(bare.length))
      return DIAL_CODES.find((d) => d.code === code)?.iso ?? null
    }
  }
  return null
}

// Región comercial a partir del ISO del teléfono, para desgloses tipo "agendas por región"
// (LATAM / USA-Canadá / España / Europa). "Otro" cubre ISOs no mapeados (p.ej. AU, sin prefijo…).
const LATAM_ISOS = new Set(['MX', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'UY', 'PY', 'BO', 'GT', 'CR', 'PA', 'DO', 'HN', 'SV', 'NI'])
const EUROPE_ISOS = new Set(['PT', 'FR', 'IT', 'DE', 'GB', 'AD'])
export function regionForISO(iso: string | null | undefined): 'España' | 'LATAM' | 'USA/Canadá' | 'Europa' | 'Otro' {
  if (!iso) return 'Otro'
  const up = iso.toUpperCase()
  if (up === 'ES') return 'España'
  if (up === 'US') return 'USA/Canadá'
  if (LATAM_ISOS.has(up)) return 'LATAM'
  if (EUROPE_ISOS.has(up)) return 'Europa'
  return 'Otro'
}

// Nombre de país legible (sin emoji ni prefijo) a partir del ISO, para etiquetas de gráficas.
export function countryNameForISO(iso: string | null | undefined): string {
  if (!iso) return 'Desconocido'
  const d = DIAL_CODES.find((d) => d.iso === iso.toUpperCase())
  if (!d) return iso.toUpperCase()
  const m = d.label.match(/^\S+\s(.+?)\s\(/)
  return m ? m[1] : d.label
}

// Separa un teléfono E.164 en {prefix, national} para pintarlo en los formularios de edición.
export function splitPhone(full: string | null | undefined): { prefix: string; national: string } {
  const value = (full || '').trim()
  if (!value) return { prefix: DEFAULT_DIAL_CODE, national: '' }
  const normalized = value.startsWith('00') ? '+' + value.slice(2) : value
  if (normalized.startsWith('+')) {
    const digits = normalized.slice(1).replace(/\D/g, '')
    for (const code of CODES_BY_LENGTH) {
      const bare = code.slice(1)
      if (digits.startsWith(bare)) {
        return { prefix: code, national: digits.slice(bare.length) }
      }
    }
    return { prefix: DEFAULT_DIAL_CODE, national: digits }
  }
  return { prefix: DEFAULT_DIAL_CODE, national: value.replace(/\D/g, '') }
}
