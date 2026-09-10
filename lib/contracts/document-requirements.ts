export type DocumentType = 'dni' | 'nie' | 'nif' | 'passport' | 'driver_license' | 'state_id' | 'ife' | 'cedula' | 'other'

export interface CountryDocumentRequirement {
  required: boolean
  types: DocumentType[]
  label: string
  instructions: string
}

export const DOCUMENT_REQUIREMENTS: Record<string, CountryDocumentRequirement> = {
  // España
  ES: {
    required: true,
    types: ['dni', 'nie', 'passport'],
    label: 'DNI, NIE, or Passport',
    instructions: 'Upload a clear photo of your DNI, NIE, or Passport. Both sides if needed.'
  },

  // Estados Unidos
  US: {
    required: true,
    types: ['passport', 'driver_license', 'state_id'],
    label: 'Passport, Driver\'s License, or State ID',
    instructions: 'Upload a clear photo of your Passport or government-issued ID.'
  },

  // México
  MX: {
    required: true,
    types: ['passport', 'ife', 'cedula'],
    label: 'Passport, IFE, or Cédula',
    instructions: 'Upload your Passport, IFE, or national ID.'
  },

  // Argentina
  AR: {
    required: true,
    types: ['cedula', 'passport'],
    label: 'Cédula or Passport',
    instructions: 'Upload your national ID or Passport.'
  },

  // Colombia
  CO: {
    required: true,
    types: ['cedula', 'passport'],
    label: 'Cédula or Passport',
    instructions: 'Upload your national ID or Passport.'
  },

  // Perú
  PE: {
    required: true,
    types: ['cedula', 'passport'],
    label: 'DNI or Passport',
    instructions: 'Upload your DNI (Documento Nacional de Identidad) or Passport.'
  },

  // Chile
  CL: {
    required: true,
    types: ['cedula', 'passport'],
    label: 'RUT/Cédula or Passport',
    instructions: 'Upload your RUT or Passport.'
  },

  // Defecto para otros países
  DEFAULT: {
    required: true,
    types: ['passport'],
    label: 'Passport',
    instructions: 'Upload a clear photo of your Passport.'
  }
}

export function getDocumentRequirement(country?: string | null): CountryDocumentRequirement {
  if (!country) return DOCUMENT_REQUIREMENTS.DEFAULT

  // Intentar match con ISO country code
  const code = country.toUpperCase().slice(0, 2)
  return DOCUMENT_REQUIREMENTS[code] || DOCUMENT_REQUIREMENTS.DEFAULT
}

export function getCountryCode(countryName?: string | null): string {
  if (!countryName) return 'DEFAULT'

  const countryMap: Record<string, string> = {
    'españa': 'ES',
    'spain': 'ES',
    'estadios unidos': 'US',
    'usa': 'US',
    'united states': 'US',
    'méxico': 'MX',
    'mexico': 'MX',
    'argentina': 'AR',
    'colombia': 'CO',
    'perú': 'PE',
    'peru': 'PE',
    'chile': 'CL'
  }

  const normalized = countryName.toLowerCase().trim()
  return countryMap[normalized] || normalized.toUpperCase().slice(0, 2) || 'DEFAULT'
}
