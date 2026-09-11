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
  required?: string[] // claves mínimas para considerar operativa la integración
  fields: IntegrationField[]
}

export const INTEGRATION_GROUPS: IntegrationGroup[] = [
  {
    id: 'meta',
    title: 'Meta Ads',
    description: 'Sincroniza el gasto y los leads de tus campañas de Meta.',
    test: true,
    required: ['META_ACCESS_TOKEN'],
    fields: [
      { key: 'META_ACCESS_TOKEN', label: 'Access Token', type: 'password', secret: true, help: 'Token de System User que no caduque.' },
      { key: 'META_APP_SECRET', label: 'App Secret', type: 'password', secret: true, help: 'Para firmar las llamadas (appsecret_proof).' },
      { key: 'META_AD_ACCOUNT_ID', label: 'Cuenta(s) publicitaria(s)', type: 'text', secret: false, placeholder: 'Vacío = todas las accesibles', help: 'Déjalo VACÍO para sincronizar TODAS las cuentas a las que el token tiene acceso. O lista cuentas concretas separadas por comas (con o sin prefijo act_).' },
      { key: 'META_API_VERSION', label: 'Versión API', type: 'text', secret: false, placeholder: 'v21.0' },
      { key: 'META_AD_ACCOUNTS_ALL', label: 'Sincronizar todas las cuentas accesibles', type: 'boolean', secret: false, help: 'Actívalo para descubrir automáticamente todas las cuentas publicitarias del token.' },
    ],
  },
  {
    id: 'instagram',
    title: 'Instagram',
    description: 'Analítica orgánica, transcripción de reels y guiones.',
    test: true,
    required: ['IG_USER_ID'],
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
    required: ['CALENDLY_API_TOKEN', 'CALENDLY_WEBHOOK_SECRET'],
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
    required: ['RESEND_API_KEY', 'RESEND_FROM'],
    fields: [
      { key: 'RESEND_API_KEY', label: 'API Key', type: 'password', secret: true, placeholder: 're_…' },
      { key: 'RESEND_FROM', label: 'Remitente', type: 'text', secret: false, placeholder: 'IA WINNERS <app@tudominio.com>' },
    ],
  },
  {
    id: 'stripe',
    title: 'Stripe',
    description: 'Verifica cobros con Stripe y coteja los pagos del proveedor con los registrados en la app.',
    test: true,
    required: ['STRIPE_SECRET_KEY'],
    fields: [
      { key: 'STRIPE_SECRET_KEY', label: 'Secret Key', type: 'password', secret: true, placeholder: 'sk_live_…', help: 'Clave secreta restringida o estándar con permiso de lectura de PaymentIntents.' },
      { key: 'STRIPE_ACCOUNT_ID', label: 'Connected Account ID (opcional)', type: 'text', secret: false, placeholder: 'acct_…', help: 'Solo para Stripe Connect. Déjalo vacío si los pagos están en la cuenta principal.' },
    ],
  },
  {
    id: 'ghl',
    title: 'GoHighLevel',
    description: 'CRM: contactos, citas (sustituye Calendly), pipeline y conversaciones.',
    test: true,
    required: ['GHL_API_TOKEN', 'GHL_LOCATION_ID', 'GHL_WEBHOOK_SECRET'],
    fields: [
      { key: 'GHL_API_TOKEN', label: 'Private Integration Token', type: 'password', secret: true, placeholder: 'pit-…', help: 'Token de Integración Privada de la subcuenta.' },
      { key: 'GHL_LOCATION_ID', label: 'Location ID', type: 'text', secret: false, placeholder: 've9EPM428h8vShlRW1KT', help: 'ID de la subcuenta (en la URL /location/<ID>/).' },
      { key: 'GHL_WEBHOOK_SECRET', label: 'Webhook Secret (entrante)', type: 'password', secret: true, help: 'Cabecera x-ghl-secret que validan los webhooks de GHL.' },
      { key: 'GHL_ONBOARDING_WEBHOOK_URL', label: 'Webhook de altas/bajas de alumnos', type: 'text', secret: false, placeholder: 'https://…', help: 'Automatización que concede o revoca acceso al curso.' },
      { key: 'GHL_ONBOARDING_WEBHOOK_SECRET', label: 'Secreto del webhook de altas/bajas', type: 'password', secret: true },
      { key: 'ONBOARDING_INBOUND_SECRET', label: 'Secreto de onboarding entrante', type: 'password', secret: true },
      { key: 'ONBOARDING_LANDING_URL', label: 'URL de onboarding', type: 'text', secret: false, placeholder: 'https://…' },
    ],
  },
  {
    id: 'ai',
    title: 'Inteligencia artificial',
    description: 'Generación de contenido, análisis, roleplays y transcripción de llamadas y reels.',
    test: true,
    required: ['ANTHROPIC_API_KEY', 'GROQ_API_KEY'],
    fields: [
      { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', type: 'password', secret: true, placeholder: 'sk-ant-…', help: 'Necesaria para asistentes, contenido, tareas y análisis.' },
      { key: 'GROQ_API_KEY', label: 'Groq API Key', type: 'password', secret: true, placeholder: 'gsk_…', help: 'Necesaria para transcribir llamadas y reels.' },
      { key: 'GOOGLE_API_KEY', label: 'Google API Key (Drive)', type: 'password', secret: true, help: 'Opcional; permite descargar grabaciones públicas de Google Drive por ID.' },
    ],
  },
  {
    id: 'youtube',
    title: 'YouTube',
    description: 'Publica reels como Shorts y sincroniza sus métricas.',
    test: true,
    required: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
    fields: [
      { key: 'YOUTUBE_CLIENT_ID', label: 'OAuth Client ID', type: 'text', secret: false },
      { key: 'YOUTUBE_CLIENT_SECRET', label: 'OAuth Client Secret', type: 'password', secret: true },
      { key: 'YOUTUBE_REFRESH_TOKEN', label: 'OAuth Refresh Token', type: 'password', secret: true },
    ],
  },
  {
    id: 'sequra',
    title: 'SeQura',
    description: 'Consulta financiación, deuda y morosidad para cotejar las cuotas.',
    test: true,
    required: ['SEQURA_MCP_TOKEN'],
    fields: [
      { key: 'SEQURA_MCP_TOKEN', label: 'Token MCP', type: 'password', secret: true, help: 'Token de acceso a SeQura. Puede caducar y debe renovarse cuando la prueba devuelva 401.' },
    ],
  },
  {
    id: 'creatuagente',
    title: 'Creatuagente',
    description: 'Notifica citas y ventas al agente externo del funnel de Setting IA.',
    test: true,
    required: ['CREATUAGENTE_WEBHOOK_URL', 'CREATUAGENTE_WEBHOOK_SECRET'],
    fields: [
      { key: 'CREATUAGENTE_WEBHOOK_URL', label: 'Webhook URL', type: 'text', secret: false, placeholder: 'https://…' },
      { key: 'CREATUAGENTE_WEBHOOK_SECRET', label: 'Webhook Secret', type: 'password', secret: true },
    ],
  },
  {
    id: 'tracking',
    title: 'Tracking y atribución',
    description: 'Protege la entrada de eventos del píxel, VSL y atribución del funnel.',
    required: ['TRACKING_INGEST_KEY'],
    fields: [
      { key: 'TRACKING_INGEST_KEY', label: 'Ingest Key', type: 'password', secret: true, help: 'Secreto compartido por las fuentes que envían eventos al endpoint de tracking.' },
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
