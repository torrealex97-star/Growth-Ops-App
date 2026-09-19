import type { SupabaseClient } from '@supabase/supabase-js'

// Datos de la empresa (por subcuenta) que se mapean en los contratos.
// Se editan desde Configuración → Datos de empresa (tabla company_profile).
// La firma de la empresa se estampa SIEMPRE de forma automática: nadie del
// equipo tiene que firmar manualmente.

export type CompanyProfile = {
  /** Subcuenta propietaria del perfil. La rellena getCompanyProfile al leer la fila;
   *  permite a los envíos de email resolver la plantilla personalizada de ESTA
   *  subcuenta sin que cada llamada tenga que pasar el tenantId aparte. */
  tenantId?: string
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

// Valores por defecto si aún no se ha configurado la fila company_profile
// de esta subcuenta (rellenar en Configuración → Datos de empresa).
const DEFAULT_COMPANY: CompanyProfile = {
  name: 'Tu Empresa',
  legal_name: null,
  cif: null,
  address: null,
  postal_code: null,
  city: null,
  country: 'España',
  representative: null,
  email: null,
  phone: null,
  logo_url: null,
  email_signature: null,
}

// Etiqueta de firma fija de la empresa.
export function companySignatureLabel(c: CompanyProfile): string {
  return `Firmado digitalmente por ${c.name}`
}

// Lee la fila de company_profile de esta subcuenta y la fusiona con los defaults.
export async function getCompanyProfile(sb: SupabaseClient, tenantId: string): Promise<CompanyProfile> {
  const { data } = await sb.from('company_profile').select('*').eq('id', 1).eq('tenant_id', tenantId).maybeSingle()
  if (!data) return { ...DEFAULT_COMPANY, tenantId }
  return {
    tenantId,
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
