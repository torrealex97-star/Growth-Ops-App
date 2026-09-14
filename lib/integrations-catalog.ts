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
  // `advanced: true` = no hace falta para conectar. Se pinta plegado bajo "Opciones avanzadas".
  // Un formulario con nueve campos cuando solo dos son obligatorios hace que la gente rellene lo que
  // no debe, o abandone pensando que le falta información que en realidad no necesita.
  advanced?: boolean
}

// Categoría para agrupar visualmente el catálogo en Configuración → Integraciones.
export type IntegrationCategory = 'marketing' | 'ventas' | 'pagos' | 'comunicacion' | 'ia' | 'seguridad' | 'negocio'

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  marketing: 'Marketing y publicidad',
  ventas: 'Ventas y agenda',
  pagos: 'Pagos y cobros',
  comunicacion: 'Comunicación',
  ia: 'Inteligencia artificial y reuniones',
  seguridad: 'Seguridad y tracking',
  negocio: 'Negocio',
}

export type IntegrationGroup = {
  id: string
  title: string
  description: string
  category: IntegrationCategory
  test?: boolean // si hay acción "probar conexión"
  required?: string[] // claves mínimas para considerar operativa la integración
  // Pantalla donde se edita este grupo. 'empresa' = no es una integración (no hay credencial,
  // conexión que probar ni sincronización): son datos de la propia empresa y se editan en
  // Configuración → Datos de empresa. Sigue en este catálogo porque su persistencia es la misma
  // (integration_settings vía el endpoint genérico, que solo acepta claves conocidas).
  surface?: 'integraciones' | 'empresa'
  fields: IntegrationField[]
}

export const INTEGRATION_GROUPS: IntegrationGroup[] = [
  {
    id: 'meta',
    title: 'Meta Ads',
    description: 'Sincroniza el gasto y los leads de tus campañas de Meta.',
    category: 'marketing',
    test: true,
    required: ['META_ACCESS_TOKEN'],
    fields: [
      {
        key: 'META_ACCESS_TOKEN',
        label: 'Access Token',
        type: 'password',
        secret: true,
        help: 'Token de System User que no caduque.',
      },
      {
        key: 'META_APP_SECRET',
        advanced: true,
        label: 'App Secret',
        type: 'password',
        secret: true,
        help: 'Para firmar las llamadas (appsecret_proof).',
      },
      {
        key: 'META_AD_ACCOUNT_ID',
        label: 'Cuenta(s) publicitaria(s)',
        type: 'text',
        secret: false,
        placeholder: 'Vacío = todas las accesibles',
        help: 'Déjalo VACÍO para sincronizar TODAS las cuentas a las que el token tiene acceso. O lista cuentas concretas separadas por comas (con o sin prefijo act_).',
      },
      {
        key: 'META_API_VERSION',
        advanced: true,
        label: 'Versión de la API',
        type: 'text',
        secret: false,
        placeholder: 'v25.0 (recomendada)',
        help: 'Déjalo vacío salvo que sepas lo que haces. Meta retira versiones por calendario: todas las anteriores a v24.0 están deprecadas desde junio de 2026.',
      },
      {
        key: 'META_AD_ACCOUNTS_ALL',
        advanced: true,
        label: 'Sincronizar todas las cuentas accesibles',
        type: 'boolean',
        secret: false,
        help: 'Actívalo para descubrir automáticamente todas las cuentas publicitarias del token.',
      },
    ],
  },
  {
    id: 'instagram',
    title: 'Instagram',
    description: 'Analítica orgánica, transcripción de reels y guiones.',
    category: 'marketing',
    test: true,
    required: ['IG_USER_ID'],
    fields: [
      {
        key: 'INSTAGRAM_ACCESS_TOKEN',
        label: 'Access Token',
        type: 'password',
        secret: true,
        help: 'Si se deja vacío, usa el token de Meta.',
      },
      {
        key: 'IG_USER_ID',
        label: 'IG User ID (business)',
        type: 'text',
        secret: false,
        placeholder: '17841400000000000',
      },
      { key: 'IG_PAGE_ID', label: 'Page ID (Facebook vinculada)', type: 'text', secret: false, advanced: true },
      {
        key: 'IG_HANDLE',
        label: 'Handle de Instagram',
        type: 'text',
        secret: false,
        placeholder: '@tucuenta',
        advanced: true,
      },
      {
        key: 'IG_ENABLE_DM_SYNC',
        label: 'Sincronizar DMs (1 = sí)',
        type: 'text',
        secret: false,
        placeholder: '0',
        advanced: true,
      },
    ],
  },
  {
    id: 'calendly',
    title: 'Calendly',
    description: 'Agendas automáticas y cancelación desde la app.',
    category: 'ventas',
    test: true,
    required: ['CALENDLY_API_TOKEN', 'CALENDLY_WEBHOOK_SECRET'],
    fields: [
      { key: 'CALENDLY_API_TOKEN', label: 'API Token (PAT)', type: 'password', secret: true },
      { key: 'CALENDLY_WEBHOOK_SECRET', label: 'Webhook Signing Key', type: 'password', secret: true },
    ],
  },
  {
    id: 'fathom',
    title: 'Fathom',
    description: 'Importa reuniones, grabaciones, resúmenes y transcripciones; incluye el servidor MCP oficial.',
    category: 'ia',
    test: true,
    required: ['FATHOM_API_KEY'],
    fields: [
      {
        key: 'FATHOM_API_KEY',
        label: 'API Key',
        type: 'password',
        secret: true,
        help: 'Se genera en Fathom → Settings → API Access. Solo accede a reuniones visibles para ese usuario/equipo.',
      },
      {
        key: 'FATHOM_MCP_URL',
        advanced: true,
        label: 'Servidor MCP oficial',
        type: 'text',
        secret: false,
        placeholder: 'https://api.fathom.ai/mcp',
        help: 'URL oficial para conectar Fathom con clientes MCP compatibles.',
      },
    ],
  },
  {
    id: 'email',
    title: 'Email (Resend)',
    description: 'Envío de invitaciones, recuperación y contratos.',
    category: 'comunicacion',
    test: true,
    required: ['RESEND_API_KEY', 'RESEND_FROM'],
    fields: [
      { key: 'RESEND_API_KEY', label: 'API Key', type: 'password', secret: true, placeholder: 're_…' },
      {
        key: 'RESEND_FROM',
        label: 'Remitente',
        type: 'text',
        secret: false,
        placeholder: 'Tu Empresa <app@tudominio.com>',
      },
    ],
  },
  {
    id: 'stripe',
    title: 'Stripe',
    description: 'Verifica cobros con Stripe y coteja los pagos del proveedor con los registrados en la app.',
    category: 'pagos',
    test: true,
    required: ['STRIPE_SECRET_KEY'],
    fields: [
      {
        key: 'STRIPE_SECRET_KEY',
        label: 'Secret Key',
        type: 'password',
        secret: true,
        placeholder: 'sk_live_…',
        help: 'Clave secreta restringida o estándar con permiso de lectura de PaymentIntents.',
      },
      {
        key: 'STRIPE_ACCOUNT_ID',
        advanced: true,
        label: 'Connected Account ID (opcional)',
        type: 'text',
        secret: false,
        placeholder: 'acct_…',
        help: 'Solo para Stripe Connect. Déjalo vacío si los pagos están en la cuenta principal.',
      },
    ],
  },
  {
    id: 'ghl',
    title: 'GoHighLevel',
    description: 'CRM: contactos, citas (sustituye Calendly), pipeline y conversaciones.',
    category: 'ventas',
    test: true,
    required: ['GHL_API_TOKEN', 'GHL_LOCATION_ID', 'GHL_WEBHOOK_SECRET'],
    fields: [
      {
        key: 'GHL_API_TOKEN',
        label: 'Private Integration Token',
        type: 'password',
        secret: true,
        placeholder: 'pit-…',
        help: 'Token de Integración Privada de la subcuenta.',
      },
      {
        key: 'GHL_LOCATION_ID',
        label: 'Location ID',
        type: 'text',
        secret: false,
        placeholder: 've9EPM428h8vShlRW1KT',
        help: 'ID de la subcuenta (en la URL /location/<ID>/).',
      },
      {
        key: 'GHL_WEBHOOK_SECRET',
        label: 'Webhook Secret (entrante)',
        type: 'password',
        secret: true,
        help: 'Cabecera x-ghl-secret que validan los webhooks de GHL.',
      },
      {
        key: 'GHL_ONBOARDING_WEBHOOK_URL',
        advanced: true,
        label: 'Webhook de altas/bajas de alumnos',
        type: 'text',
        secret: false,
        placeholder: 'https://…',
        help: 'Automatización que concede o revoca acceso al curso.',
      },
      {
        key: 'GHL_ONBOARDING_WEBHOOK_SECRET',
        advanced: true,
        label: 'Secreto del webhook de altas/bajas',
        type: 'password',
        secret: true,
      },
      {
        key: 'ONBOARDING_INBOUND_SECRET',
        label: 'Secreto de onboarding entrante',
        type: 'password',
        secret: true,
        advanced: true,
      },
      {
        key: 'ONBOARDING_LANDING_URL',
        advanced: true,
        label: 'URL de onboarding',
        type: 'text',
        secret: false,
        placeholder: 'https://…',
      },
    ],
  },
  {
    id: 'ai',
    title: 'Inteligencia artificial',
    description: 'Generación de contenido, análisis, roleplays y transcripción de llamadas y reels.',
    category: 'ia',
    test: true,
    required: ['ANTHROPIC_API_KEY', 'GROQ_API_KEY'],
    fields: [
      {
        key: 'ANTHROPIC_API_KEY',
        label: 'Anthropic API Key',
        type: 'password',
        secret: true,
        placeholder: 'sk-ant-…',
        help: 'Necesaria para asistentes, contenido, tareas y análisis.',
      },
      {
        key: 'GROQ_API_KEY',
        label: 'Groq API Key',
        type: 'password',
        secret: true,
        placeholder: 'gsk_…',
        help: 'Necesaria para transcribir llamadas y reels.',
      },
      {
        key: 'GOOGLE_API_KEY',
        advanced: true,
        label: 'Google API Key (Drive)',
        type: 'password',
        secret: true,
        help: 'Opcional; permite descargar grabaciones públicas de Google Drive por ID.',
      },
    ],
  },
  {
    id: 'deepseek',
    title: 'DeepSeek',
    description:
      'Motor de IA de la subcuenta: análisis de llamadas, guiones, tareas desde transcripción y variables de contrato.',
    category: 'ia',
    test: true,
    required: ['DEEPSEEK_API_KEY'],
    fields: [
      {
        key: 'DEEPSEEK_API_KEY',
        label: 'DeepSeek API Key',
        type: 'password',
        secret: true,
        placeholder: 'sk-…',
        help: 'Crea la clave en la plataforma de DeepSeek. Se guarda cifrada y solo se utiliza en el servidor.',
      },
      {
        key: 'DEEPSEEK_MODEL',
        advanced: true,
        label: 'Modelo predeterminado',
        type: 'text',
        secret: false,
        placeholder: 'Se busca en tu cuenta',
        help: 'Opcional. Pulsa "Buscar modelos" para ver los que tu clave puede usar de verdad; si queda vacío se usa el primero disponible. Escribir un nombre a mano que el proveedor no tenga deja la IA muerta sin avisar.',
      },
    ],
  },
  {
    id: 'youtube',
    title: 'YouTube',
    description: 'Publica reels como Shorts y sincroniza sus métricas.',
    category: 'marketing',
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
    category: 'pagos',
    test: true,
    required: ['SEQURA_MCP_TOKEN'],
    fields: [
      {
        key: 'SEQURA_MCP_TOKEN',
        label: 'Token MCP',
        type: 'password',
        secret: true,
        help: 'Token de acceso a SeQura. Puede caducar y debe renovarse cuando la prueba devuelva 401.',
      },
    ],
  },
  {
    id: 'creatuagente',
    title: 'Creatuagente',
    description: 'Notifica citas y ventas al agente externo del funnel de Setting IA.',
    category: 'ventas',
    test: true,
    required: ['CREATUAGENTE_WEBHOOK_URL', 'CREATUAGENTE_WEBHOOK_SECRET'],
    fields: [
      { key: 'CREATUAGENTE_WEBHOOK_URL', label: 'Webhook URL', type: 'text', secret: false, placeholder: 'https://…' },
      { key: 'CREATUAGENTE_WEBHOOK_SECRET', label: 'Webhook Secret', type: 'password', secret: true },
    ],
  },
  {
    id: 'hotmart',
    title: 'Hotmart',
    description: 'Cotejo de compras y suscripciones de tus productos vendidos en Hotmart.',
    category: 'pagos',
    test: true,
    required: ['HOTMART_CLIENT_ID', 'HOTMART_CLIENT_SECRET'],
    fields: [
      {
        key: 'HOTMART_CLIENT_ID',
        label: 'Client ID',
        type: 'text',
        secret: false,
        help: 'Credencial de la API de Hotmart (Herramientas → Credenciales).',
      },
      { key: 'HOTMART_CLIENT_SECRET', label: 'Client Secret', type: 'password', secret: true },
      {
        key: 'HOTMART_BASIC_TOKEN',
        label: 'Token Basic',
        type: 'password',
        secret: true,
        advanced: true,
        help: 'Opcional. Hotmart muestra un "token Basic" junto al Client ID y el Secret. Si lo dejas vacío se calcula a partir de los otros dos, que es lo que hace Hotmart; ponlo solo si el suyo es distinto.',
      },
      {
        key: 'HOTMART_WEBHOOK_SECRET',
        advanced: true,
        label: 'Webhook Secret (Hottok)',
        type: 'password',
        secret: true,
        help: 'Token que valida los webhooks entrantes de compra/suscripción/reembolso de Hotmart.',
      },
    ],
  },
  {
    id: 'whop',
    title: 'Whop',
    description: 'Cotejo de membresías y pagos de tu comunidad en Whop.',
    category: 'pagos',
    test: true,
    required: ['WHOP_API_KEY'],
    fields: [
      {
        key: 'WHOP_API_KEY',
        label: 'API Key',
        type: 'password',
        secret: true,
        help: 'Clave de la API de Whop (Developer Settings) con acceso de lectura a membresías y pagos.',
      },
      {
        key: 'WHOP_WEBHOOK_SECRET',
        advanced: true,
        label: 'Webhook Secret',
        type: 'password',
        secret: true,
        help: 'Firma que valida los webhooks entrantes de Whop (altas/bajas/pagos de membresía).',
      },
    ],
  },
  {
    id: 'skool',
    title: 'Skool',
    description: 'Cotejo de miembros y pagos de tu comunidad/curso en Skool.',
    category: 'pagos',
    // Skool no expone una API pública oficial y estable para verificar credenciales — a diferencia
    // de Hotmart/Whop, aquí no hay "Probar conexión" (sin test:true); se guarda igualmente para
    // poder usarse en webhooks/cotejo manual.
    required: ['SKOOL_API_KEY'],
    fields: [
      {
        key: 'SKOOL_API_KEY',
        label: 'API Key',
        type: 'password',
        secret: true,
        help: 'Clave de la API de Skool con acceso de lectura a miembros y pagos de la comunidad.',
      },
      {
        key: 'SKOOL_WEBHOOK_SECRET',
        advanced: true,
        label: 'Webhook Secret',
        type: 'password',
        secret: true,
        help: 'Firma que valida los webhooks entrantes de Skool (altas/bajas/pagos de miembros).',
      },
    ],
  },
  {
    id: 'tracking',
    title: 'Tracking y atribución',
    description: 'Protege la entrada de eventos del píxel, VSL y atribución del funnel.',
    category: 'seguridad',
    required: ['TRACKING_INGEST_KEY'],
    fields: [
      {
        key: 'TRACKING_INGEST_KEY',
        label: 'Ingest Key',
        type: 'password',
        secret: true,
        help: 'Secreto compartido por las fuentes que envían eventos al endpoint de tracking.',
      },
    ],
  },
  {
    id: 'google',
    title: 'Google (GA4 y Gmail)',
    description: 'Credenciales del proyecto de Google Cloud. La conexión de cada servicio se autoriza aparte.',
    category: 'marketing',
    required: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    fields: [
      {
        key: 'GOOGLE_CLIENT_ID',
        label: 'Client ID',
        type: 'text',
        secret: false,
        help: 'Del cliente OAuth de tipo "Aplicación web". Es público por diseño.',
      },
      {
        key: 'GOOGLE_CLIENT_SECRET',
        label: 'Client Secret',
        type: 'password',
        secret: true,
        help: 'Google solo lo muestra una vez. Se guarda cifrado y nunca se vuelve a mostrar en claro.',
      },
    ],
  },
  {
    id: 'negocio',
    title: 'Negocio',
    description: 'Contexto que usa la IA para generar guiones a tu estilo.',
    category: 'negocio',
    surface: 'empresa',
    fields: [
      {
        key: 'IG_BUSINESS_CONTEXT',
        label: 'Contexto de negocio',
        type: 'textarea',
        secret: false,
        help: 'Modelo de negocio, avatares y funnel. Lo usa la IA al generar guiones y los carruseles/flyers.',
      },
      {
        key: 'IG_BRAND_ASSETS',
        label: 'Assets de marca (JSON interno)',
        type: 'text',
        secret: false,
        hidden: true,
        help: 'Array JSON {url,name} de logos/fotos de marca. Gestionado desde Configuración → Datos de empresa.',
      },
    ],
  },
]

export const ALL_FIELDS: IntegrationField[] = INTEGRATION_GROUPS.flatMap((g) => g.fields)

// Grupos que se pintan en Configuración → Integraciones: todo menos lo que no es una integración.
export const INTEGRATION_ONLY_GROUPS: IntegrationGroup[] = INTEGRATION_GROUPS.filter((g) => g.surface !== 'empresa')
export const SECRET_KEYS = new Set(ALL_FIELDS.filter((f) => f.secret).map((f) => f.key))
export function isKnownKey(k: string): boolean {
  return ALL_FIELDS.some((f) => f.key === k)
}
