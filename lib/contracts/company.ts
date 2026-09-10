import type { SupabaseClient } from '@supabase/supabase-js'

// Datos de LA EMPRESA ([tenant]) que se mapean en los contratos.
// Se editan desde Configuración → Datos de empresa (tabla company_profile).
// La firma de la empresa se estampa SIEMPRE de forma automática: nadie del
// equipo tiene que firmar manualmente.

export type CompanyProfile = {
  name: string
  legal_name: string | null
  cif: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  representative: string | null
  email: string | null
  phone: string | null
  logo_url: string | null
  email_signature: string | null
}

// Valores por defecto si aún no se ha configurado la fila company_profile.
export const DEFAULT_COMPANY: CompanyProfile = {
  name: '[tenant]',
  legal_name: '[tenant]',
  cif: 'B-00000000',
  address: null,
  postal_code: null,
  city: null,
  country: 'España',
  representative: 'Dirección [tenant]',
  email: null,
  phone: null,
  logo_url: null,
  email_signature: null,
}

// Etiqueta de firma fija de la empresa.
export function companySignatureLabel(c: CompanyProfile): string {
  return `Firmado digitalmente por ${c.name}`
}

// Lee la fila única de company_profile (id=1) y la fusiona con los defaults.
export async function getCompanyProfile(sb: SupabaseClient): Promise<CompanyProfile> {
  const { data } = await sb.from('company_profile').select('*').eq('id', 1).maybeSingle()
  if (!data) return DEFAULT_COMPANY
  return {
    name: data.name || DEFAULT_COMPANY.name,
    legal_name: data.legal_name ?? DEFAULT_COMPANY.legal_name,
    cif: data.cif ?? DEFAULT_COMPANY.cif,
    address: data.address ?? null,
    postal_code: data.postal_code ?? null,
    city: data.city ?? null,
    country: data.country ?? DEFAULT_COMPANY.country,
    representative: data.representative ?? DEFAULT_COMPANY.representative,
    email: data.email ?? null,
    phone: data.phone ?? null,
    logo_url: data.logo_url ?? null,
    email_signature: data.email_signature ?? null,
  }
}
