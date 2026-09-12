// Zona horaria del CONTACTO (no la del closer/setter que usa la app) para mandarla a Calendly.
// Antes se usaba Intl.DateTimeFormat() del navegador de quien agenda, que casi siempre es España,
// así que un lead en LatAm recibía la confirmación/ICS de Calendly con la hora etiquetada como si
// fuese la del closer. Aquí se adivina la zona horaria real a partir del teléfono del contacto
// (ya normalizado a E.164, fiable) y, si no hay señal, del país en texto libre.

import { DIAL_CODES, countryISOForPhone, countryNameForISO } from './phone'

export const DEFAULT_TIMEZONE = 'Europe/Madrid'

// Un país puede tener varias zonas horarias (México, Argentina, Brasil, EE.UU...); se usa la de la
// capital / mayor población como mejor estimación por defecto. El selector en la UI permite corregirla.
const TIMEZONE_BY_ISO: Record<string, string> = {
  ES: 'Europe/Madrid',
  MX: 'America/Mexico_City',
  AR: 'America/Argentina/Buenos_Aires',
  CO: 'America/Bogota',
  CL: 'America/Santiago',
  PE: 'America/Lima',
  VE: 'America/Caracas',
  EC: 'America/Guayaquil',
  UY: 'America/Montevideo',
  PY: 'America/Asuncion',
  BO: 'America/La_Paz',
  GT: 'America/Guatemala',
  CR: 'America/Costa_Rica',
  PA: 'America/Panama',
  DO: 'America/Santo_Domingo',
  HN: 'America/Tegucigalpa',
  SV: 'America/El_Salvador',
  NI: 'America/Managua',
  US: 'America/New_York',
  PT: 'Europe/Lisbon',
  FR: 'Europe/Paris',
  IT: 'Europe/Rome',
  DE: 'Europe/Berlin',
  GB: 'Europe/London',
  AD: 'Europe/Andorra',
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

function isoForCountryName(name: string): string | null {
  const n = normalize(name)
  const match = DIAL_CODES.find((d) => normalize(countryNameForISO(d.iso)) === n)
  return match?.iso ?? null
}

export function timezoneForISO(iso: string | null | undefined): string | null {
  if (!iso) return null
  return TIMEZONE_BY_ISO[iso.toUpperCase()] ?? null
}

// Mejor estimación de la zona horaria del contacto: primero por prefijo telefónico, luego por el
// país en texto libre, y si no hay ninguna señal se cae a España (mercado principal).
export function guessContactTimezone(
  contact: { phone?: string | null; country?: string | null } | null | undefined
): string {
  if (!contact) return DEFAULT_TIMEZONE
  const byPhone = timezoneForISO(countryISOForPhone(contact.phone))
  if (byPhone) return byPhone
  const byCountry = contact.country ? timezoneForISO(isoForCountryName(contact.country)) : null
  return byCountry ?? DEFAULT_TIMEZONE
}

// Opciones para el selector manual de zona horaria (una por cada país que ya soportamos en telefonía).
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = Array.from(
  new Map(
    DIAL_CODES.map((d) => {
      const tz = TIMEZONE_BY_ISO[d.iso]
      return [tz, { value: tz, label: `${countryNameForISO(d.iso)} (${tz})` }] as const
    })
  ).values()
)
