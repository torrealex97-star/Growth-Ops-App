// Webhook SALIENTE hacia GoHighLevel para activar la automatización de onboarding
// (dar accesos al curso) cuando el alumno FIRMA el contrato.
//
// La URL se configura en la variable de entorno GHL_ONBOARDING_WEBHOOK_URL. Mientras
// no esté configurada, la función NO falla: simplemente no envía nada y devuelve
// {ok:false, skipped:true}. Así el flujo de firma queda operativo desde ya y el
// webhook se "enchufa" en cuanto se pegue la URL (tras la sesión con Alex/GHL).

export type OnboardingWebhookPayload = {
  contractId: string
  saleId: string | null
  contactId: string | null
  // Nombre completo del firmante + partido (GHL crea el contacto si no existe).
  name: string
  first_name?: string | null
  last_name?: string | null
  email: string | null
  phone: string | null
  // Datos extra del lead (por si GHL tiene que crear el contacto de cero).
  dni?: string | null
  address?: string | null
  city?: string | null
  country?: string | null
  instagram?: string | null
  // Condiciones de la venta (útiles para el onboarding).
  product: string
  duration_months: number | null
  amount?: number | null
  currency?: string | null
  payment_method?: string | null
  plan_name?: string | null
  ghl_contact_id?: string | null
}

import { normalizePhoneE164, dialCodeForCountryISO } from './phone'

export function onboardingWebhookConfigured(): boolean {
  return !!process.env.GHL_ONBOARDING_WEBHOOK_URL
}

// GHL exige el país en código ISO 3166-1 alpha-2 (ej. "ES"), no el nombre completo
// ("España"). Convertimos los nombres más comunes; si ya es un código de 2 letras lo
// dejamos; si no lo reconocemos devolvemos null (mejor omitirlo que romper el webhook).
const COUNTRY_ISO: Record<string, string> = {
  espana: 'ES',
  españa: 'ES',
  spain: 'ES',
  mexico: 'MX',
  méxico: 'MX',
  argentina: 'AR',
  colombia: 'CO',
  chile: 'CL',
  peru: 'PE',
  perú: 'PE',
  venezuela: 'VE',
  ecuador: 'EC',
  uruguay: 'UY',
  paraguay: 'PY',
  bolivia: 'BO',
  guatemala: 'GT',
  'costa rica': 'CR',
  panama: 'PA',
  panamá: 'PA',
  'republica dominicana': 'DO',
  'república dominicana': 'DO',
  'dominican republic': 'DO',
  honduras: 'HN',
  'el salvador': 'SV',
  nicaragua: 'NI',
  'puerto rico': 'PR',
  'estados unidos': 'US',
  'united states': 'US',
  usa: 'US',
  eeuu: 'US',
  portugal: 'PT',
  francia: 'FR',
  france: 'FR',
  italia: 'IT',
  italy: 'IT',
  alemania: 'DE',
  germany: 'DE',
  'reino unido': 'GB',
  'united kingdom': 'GB',
  uk: 'GB',
  andorra: 'AD',
}

export function toCountryISO(country: string | null | undefined): string | null {
  if (!country) return null
  const raw = country.trim()
  if (!raw) return null
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase()
  return COUNTRY_ISO[raw.toLowerCase()] ?? null
}

async function postToOnboardingWebhook(
  event: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; skipped?: boolean; status?: number; error?: string }> {
  const url = process.env.GHL_ONBOARDING_WEBHOOK_URL
  if (!url) return { ok: false, skipped: true }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Cabecera opcional por si la automatización de GHL quiere validar origen.
        ...(process.env.GHL_ONBOARDING_WEBHOOK_SECRET
          ? { 'x-onboarding-secret': process.env.GHL_ONBOARDING_WEBHOOK_SECRET }
          : {}),
      },
      body: JSON.stringify({ event, ...payload }),
    })
    if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}` }
    return { ok: true, status: res.status }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function fireOnboardingWebhook(
  payload: OnboardingWebhookPayload
): Promise<{ ok: boolean; skipped?: boolean; status?: number; error?: string }> {
  // Red de seguridad: normaliza el teléfono a E.164 (usa el país si el número no
  // trae prefijo) para que GHL nunca lo interprete como +1.
  const safePhone = payload.phone
    ? normalizePhoneE164(payload.phone, dialCodeForCountryISO(payload.country))
    : payload.phone
  return postToOnboardingWebhook('contract.signed', { ...payload, phone: safePhone })
}

// Control de accesos al curso desde la plataforma: reutiliza el MISMO webhook saliente de
// onboarding (misma automatización de GHL, distinto evento) para no requerir una URL nueva.
// Grant/revoke real lo ejecuta la automatización de GHL al recibir el evento; aquí solo lo
// disparamos y registramos cuándo se pidió.
export async function fireCourseAccessWebhook(
  action: 'grant' | 'revoke',
  payload: { saleId: string; contactId: string | null; email: string | null; phone: string | null; product: string }
): Promise<{ ok: boolean; skipped?: boolean; status?: number; error?: string }> {
  return postToOnboardingWebhook(`course_access.${action}`, payload)
}
