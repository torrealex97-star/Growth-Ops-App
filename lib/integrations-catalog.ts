// Catálogo de claves configurables desde el panel Configuración → Integraciones.
// `secret: true` => se cifra en BBDD y se muestra enmascarado. `secret: false` => texto plano.

export type FieldType = 'text' | 'password' | 'textarea' | 'boolean'

export type IntegrationField = {
  key: string
  label: string
  type: FieldType
  secret: boolean
  placeholder?: string
  help?: string
  // Campos "hidden" existen en el catálogo (para poder guardarse vía el endpoint genérico)
  // pero no se pintan con el formulario genérico — tienen su propia UI a medida en la página.
  hidden?: boolean
}

export type IntegrationGroup = {
  id: string
  title: string
  description: string
  test?: boolean // si hay acción "probar conexión"
  fields: IntegrationField[]
}

export const INTEGRATION_GROUPS: IntegrationGroup[] = [
  {
    id: 'meta',
    title: 'Meta Ads',
    description: 'Sincroniza el gasto y los leads de tus campañas de Meta.',
    test: true,
    fields: [
      { key: 'META_ACCESS_TOKEN', label: 'Access Token', type: 'password', secret: true, help: 'Token de System User que no caduque.' },
      { key: 'META_APP_SECRET', label: 'App Secret', type: 'password', secret: true, help: 'Para firmar las llamadas (appsecret_proof).' },
      { key: 'META_AD_ACCOUNT_ID', label: 'Cuenta(s) publicitaria(s)', type: 'text', secret: false, placeholder: 'Vacío = todas las accesibles', help: 'Déjalo VACÍO para sincronizar TODAS las cuentas a las que el token tiene acceso. O lista cuentas concretas separadas por comas (con o sin prefijo act_).' },
      { key: 'META_API_VERSION', label: 'Versión API', type: 'text', secret: false, placeholder: 'v21.0' },
    ],
  },
  {
    id: 'instagram',
    title: 'Instagram',
    description: 'Analítica orgánica, transcripción de reels y guiones.',
    test: true,
    fields: [
      { key: 'INSTAGRAM_ACCESS_TOKEN', label: 'Access Token', type: 'password', secret: true, help: 'Si se deja vacío, usa el token de Meta.' },
      { key: 'IG_USER_ID', label: 'IG User ID (business)', type: 'text', secret: false, placeholder: '17841400000000000' },
      { key: 'IG_PAGE_ID', label: 'Page ID (Facebook vinculada)', type: 'text', secret: false },
      { key: 'IG_HANDLE', label: 'Handle de Instagram', type: 'text', secret: false, placeholder: '@tucuenta' },
      { key: 'IG_ENABLE_DM_SYNC', label: 'Sincronizar DMs (1 = sí)', type: 'text', secret: false, placeholder: '0' },
    ],
  },
  {
    id: 'calendly',
    title: 'Calendly',
    description: 'Agendas automáticas y cancelación desde la app.',
    test: true,
    fields: [
      { key: 'CALENDLY_API_TOKEN', label: 'API Token (PAT)', type: 'password', secret: true },
      { key: 'CALENDLY_WEBHOOK_SECRET', label: 'Webhook Signing Key', type: 'password', secret: true },
    ],
  },
  {
    id: 'email',
    title: 'Email (Resend)',
    description: 'Envío de invitaciones, recuperación y contratos.',
    test: true,
    fields: [
      { key: 'RESEND_API_KEY', label: 'API Key', type: 'password', secret: true, placeholder: 're_…' },
      { key: 'RESEND_FROM', label: 'Remitente', type: 'text', secret: false, placeholder: '[tenant] <app@tudominio.com>' },
    ],
  },
  {
    id: 'ghl',
    title: 'GoHighLevel',
    description: 'CRM: contactos, citas (sustituye Calendly), pipeline y conversaciones.',
    test: true,
    fields: [
      { key: 'GHL_API_TOKEN', label: 'Private Integration Token', type: 'password', secret: true, placeholder: 'pit-…', help: 'Token de Integración Privada de la subcuenta.' },
      { key: 'GHL_LOCATION_ID', label: 'Location ID', type: 'text', secret: false, placeholder: 've9EPM428h8vShlRW1KT', help: 'ID de la subcuenta (en la URL /location/<ID>/).' },
      { key: 'GHL_WEBHOOK_SECRET', label: 'Webhook Secret (entrante)', type: 'password', secret: true, help: 'Cabecera x-ghl-secret que validan los webhooks de GHL.' },
    ],
  },
  {
    id: 'negocio',
    title: 'Negocio',
    description: 'Contexto que usa la IA para generar guiones a tu estilo.',
    fields: [
      { key: 'IG_BUSINESS_CONTEXT', label: 'Contexto de negocio', type: 'textarea', secret: false, help: 'Modelo de negocio, avatares y funnel. Lo usa la IA al generar guiones y los carruseles/flyers.' },
      { key: 'IG_BRAND_ASSETS', label: 'Assets de marca (JSON interno)', type: 'text', secret: false, hidden: true, help: 'Array JSON {url,name} de logos/fotos de marca. Gestionado desde la sección "Assets de marca" de abajo.' },
    ],
  },
]

export const ALL_FIELDS: IntegrationField[] = INTEGRATION_GROUPS.flatMap((g) => g.fields)
export const SECRET_KEYS = new Set(ALL_FIELDS.filter((f) => f.secret).map((f) => f.key))
export function isKnownKey(k: string): boolean { return ALL_FIELDS.some((f) => f.key === k) }
