// Catálogo de claves configurables desde el panel Configuración → Integraciones.
// `secret: true` => se cifra en BBDD y se muestra enmascarado. `secret: false` => texto plano.

type FieldType = 'text' | 'password' | 'textarea' | 'boolean'

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
  requiredAny?: string[] // alternativas: basta con una (p. ej. DeepSeek O Anthropic)
  // Pantalla donde se edita este grupo. 'empresa' = no es una integración (no hay credencial,
  // conexión que probar ni sincronización): son datos de la propia empresa y se editan en
  // Configuración → Datos de empresa. Sigue en este catálogo porque su persistencia es la misma
  // (integration_settings vía el endpoint genérico, que solo acepta claves conocidas).
  surface?: 'integraciones' | 'empresa'
  // Guía de puesta en marcha. Existe porque las credenciales no se "rellenan": se van a buscar a
  // otro producto, y saber DÓNDE es la mitad del trabajo. Sin esto, configurar una integración
  // exige que alguien técnico esté delante.
  pasos?: { titulo: string; detalle: string }[]
  // Ruta del webhook ENTRANTE de este proveedor, con `{tenant}` por rellenar. La pantalla la pinta
  // ya montada y con botón de copiar: construir una URL a mano es donde se cuela la errata que
  // luego tarda una tarde en encontrarse.
  webhookPath?: string
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
    pasos: [
      {
        titulo: 'Localiza el ID de la cuenta publicitaria',
        detalle:
          'En business.facebook.com, junto al nombre de la cuenta publicitaria verás un número largo precedido de act_. Ese es el Ad Account ID. Si gestionas varias, puedes pegarlas separadas por comas.',
      },
      {
        titulo: 'Genera el Access Token en Meta for Developers',
        detalle:
          'En developers.facebook.com, abre una app de tipo Business y usa el Explorador de la API Graph pidiendo los permisos ads_read y read_insights. El token corto caduca en horas: conviértelo en uno de larga duración antes de pegarlo, o habrá que repetirlo cada día.',
      },
      {
        titulo: 'Prueba la conexión',
        detalle:
          'Si da error de permisos, casi siempre falta ads_read o el token es de una cuenta sin acceso a esa cuenta publicitaria. El gasto tarda unas horas en aparecer: Meta no lo publica al instante.',
      },
    ],
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
    pasos: [
      {
        titulo: 'La cuenta debe ser profesional y estar enlazada a una página',
        detalle:
          'Instagram solo deja leer métricas de cuentas de empresa o creador vinculadas a una página de Facebook. Si es personal, ningún token funcionará: conviértela primero desde los ajustes de Instagram.',
      },
      {
        titulo: 'Consigue el IG User ID',
        detalle:
          'Es un número largo, distinto del arroba de tu perfil. Se obtiene desde el Explorador de la API Graph consultando la página enlazada y su campo instagram_business_account.',
      },
      {
        titulo: 'Usa un token con permisos de Instagram',
        detalle:
          'El mismo token de Meta sirve si incluye instagram_basic e instagram_manage_insights. Sin ellos la sincronización devuelve el error 10 (no tienes permiso) aunque el token sea válido para anuncios.',
      },
    ],
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
    id: 'tiktok',
    title: 'TikTok',
    description:
      'Cuenta propia de TikTok. El handle declara la cuenta en los guards de Apify (jamás se investiga por scraping); sus métricas vendrán de la API oficial cuando exista la sync.',
    category: 'marketing',
    fields: [
      {
        key: 'TIKTOK_HANDLE',
        label: 'Handle de TikTok',
        type: 'text',
        secret: false,
        placeholder: '@tucuenta',
        help: 'Sin @ al guardar no pasa nada: el sistema lo normaliza. Se usa para impedir que Apify scrapee esta cuenta y, en el futuro, para la sync oficial.',
      },
    ],
  },
  {
    id: 'apify',
    title: 'Apify (investigación externa)',
    description:
      'Datos públicos de terceros (perfiles, reels, competidores) vía proveedor externo. NO toca tu cuenta de Instagram: esa se gestiona solo con la API oficial de Meta.',
    category: 'marketing',
    test: true,
    required: ['APIFY_API_TOKEN'],
    webhookPath: '/api/webhooks/apify',
    pasos: [
      {
        titulo: 'Crea el API Token en Apify',
        detalle:
          'En console.apify.com, Settings → Integrations → API tokens. Copia el token personal. Ten en cuenta el consumo: cada investigación gasta créditos de tu cuenta de Apify.',
      },
      {
        titulo: 'Los IDs de actor ya vienen puestos',
        detalle:
          'Los campos de actor traen valores por defecto que funcionan. Solo cámbialos si quieres usar otro actor: su ID está en la URL dentro de Apify, con el formato usuario~nombre-del-actor.',
      },
      {
        titulo: 'Ajusta los límites antes de lanzar nada grande',
        detalle:
          'Resultados por investigación y máximo de perfiles controlan cuánto se gasta en cada ejecución. Empieza con valores bajos y súbelos al ver el coste real en Apify.',
      },
    ],
    fields: [
      {
        key: 'APIFY_API_TOKEN',
        label: 'API Token',
        type: 'password',
        secret: true,
        help: 'Se genera en console.apify.com → Settings → API & Integraciones. Se guarda cifrado y nunca se vuelve a mostrar completo.',
      },
      {
        key: 'APIFY_INSTAGRAM_REELS_ACTOR_ID',
        label: 'Actor: Reels de Instagram',
        type: 'text',
        secret: false,
        placeholder: 'apify/instagram-reel-scraper',
        advanced: true,
        help: 'Identificador del Actor (nombre o ID). Cambiarlo aquí no toca código: la capa de adaptadores se adapta al esquema del Actor configurado.',
      },
      {
        key: 'APIFY_INSTAGRAM_PROFILE_ACTOR_ID',
        label: 'Actor: Perfiles de Instagram',
        type: 'text',
        secret: false,
        placeholder: 'apify/instagram-scraper',
        advanced: true,
      },
      {
        key: 'APIFY_TIKTOK_ACTOR_ID',
        label: 'Actor: TikTok',
        type: 'text',
        secret: false,
        placeholder: 'clockworks/tiktok-scraper',
        advanced: true,
      },
      {
        key: 'APIFY_YOUTUBE_ACTOR_ID',
        label: 'Actor: YouTube',
        type: 'text',
        secret: false,
        placeholder: 'streamers/youtube-scraper',
        advanced: true,
      },
      {
        key: 'APIFY_RESULTS_LIMIT',
        label: 'Resultados por investigación',
        type: 'text',
        secret: false,
        placeholder: '30',
        advanced: true,
      },
      {
        key: 'APIFY_MAX_PROFILES_PER_RUN',
        label: 'Máximo de perfiles por ejecución',
        type: 'text',
        secret: false,
        placeholder: '10',
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
    webhookPath: '/api/{tenant}/evergreen/webhooks/calendly',
    pasos: [
      {
        titulo: 'Crea el token personal en Calendly',
        detalle:
          'En Calendly, Integraciones → API y webhooks → Personal Access Tokens → Generate. Se enseña una sola vez: cópialo antes de cerrar. Hace falta plan de pago para tener API.',
      },
      {
        titulo: 'Inventa la clave de firma y guárdala aquí',
        detalle:
          'No la da Calendly: la eliges tú, como una contraseña. Usa algo largo y aleatorio, guárdalo en el campo de abajo y tenlo a mano para el paso siguiente.',
      },
      {
        titulo: 'Da de alta el webhook con la dirección de arriba',
        detalle:
          'En la misma pantalla de API y webhooks, crea una suscripción con la dirección que aparece aquí arriba y pega como signing key la clave del paso 2. Suscríbete a invitee.created e invitee.canceled: alta y baja de reserva.',
      },
    ],
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
    pasos: [
      {
        titulo: 'Genera la API Key en Fathom',
        detalle:
          'En la configuración de tu cuenta de Fathom, apartado de API o integraciones, crea una clave nueva con acceso a las grabaciones y transcripciones de las reuniones del equipo.',
      },
      {
        titulo: 'Comprueba que las reuniones llevan invitado con correo',
        detalle:
          'La app empareja cada grabación con su cita por el correo del invitado. Si se crean sin invitado identificado, la grabación entra pero queda en la cola de revisión en vez de asociarse sola.',
      },
    ],
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
    pasos: [
      {
        titulo: 'Verifica tu dominio en Resend',
        detalle:
          'En resend.com/domains → Add Domain. Te dará tres registros DNS (un MX y dos TXT) que hay que añadir donde tengas el dominio. Sin dominio verificado, Resend SOLO entrega a la dirección con la que te registraste: los demás no salen, ni a spam.',
      },
      {
        titulo: 'Crea la API Key',
        detalle: 'En resend.com/api-keys → Create. Con permiso de envío basta. Se enseña una sola vez.',
      },
      {
        titulo: 'Escribe el remitente con el formato completo',
        detalle:
          'Nombre y dirección juntos, así: Mi Empresa <hola@midominio.com>. El dominio tiene que ser el que verificaste en el paso 1; con otro, Resend rechaza el envío.',
      },
    ],
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
    webhookPath: '/api/{tenant}/evergreen/webhooks/stripe',
    pasos: [
      {
        titulo: 'Copia la clave secreta desde Stripe',
        detalle:
          'En dashboard.stripe.com, Desarrolladores → Claves de API. Usa la clave SECRETA (empieza por sk_live_ en producción, sk_test_ en pruebas). La publicable no sirve: no puede leer cobros.',
      },
      {
        titulo: 'Crea el webhook con la dirección de arriba',
        detalle:
          'Desarrolladores → Webhooks → Añadir endpoint. Pega la dirección que aparece aquí arriba y suscríbete al menos a payment_intent.succeeded, charge.refunded e invoice.payment_failed: cobro, devolución e impago.',
      },
      {
        titulo: 'Copia el signing secret que te da Stripe',
        detalle:
          'Al crear el endpoint, Stripe muestra un valor que empieza por whsec_. Este sí lo da Stripe, a diferencia de otros webhooks donde la clave la eliges tú, y sirve para comprobar que el aviso viene de ellos.',
      },
    ],
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
        // El webhook es la mitad CONTINUA de la ingesta: sin esto, un cobro no existe en la app hasta
        // que alguien pulsa el importador. No es `required` porque la Secret Key sola ya permite el
        // backfill histórico y la conciliación; sin el secreto lo que se pierde es el tiempo real.
        key: 'STRIPE_WEBHOOK_SECRET',
        label: 'Signing secret del webhook',
        type: 'password',
        secret: true,
        placeholder: 'whsec_…',
        help: 'De Stripe → Developers → Webhooks, en el endpoint que apunta a /api/{subcuenta}/evergreen/webhooks/stripe. Sin él los eventos entrantes se rechazan: no se puede verificar quién los envía.',
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
    webhookPath: '/api/{tenant}/evergreen/webhooks/ghl',
    pasos: [
      {
        titulo: 'Copia el Location ID desde la URL de GHL',
        detalle:
          'Entra en tu subcuenta de GoHighLevel y mira la barra de direcciones del navegador. ' +
          'Verás algo como .../location/SZwf.../ — ese trozo entre barras es el Location ID. ' +
          'Cópialo y pégalo abajo.',
      },
      {
        titulo: 'Crea el token en GHL: Ajustes → Integraciones privadas',
        detalle:
          'En GHL, Settings (Ajustes) → Private Integrations → New. Dale un nombre (por ejemplo ' +
          '"GrowthOps") y marca los permisos de contactos, calendarios y oportunidades. Al crearla ' +
          'te enseña el token UNA sola vez y empieza por "pit-": cópialo antes de cerrar y pégalo abajo.',
      },
      {
        titulo: 'Inventa una contraseña para el webhook y guárdala aquí',
        detalle:
          'No la da GHL: la eliges tú. Sirve para que nadie que conozca la dirección del webhook ' +
          'pueda meter citas falsas. Usa algo largo y aleatorio (30 caracteres o más, letras y ' +
          'números). Escríbela en el campo de abajo, guarda, y tenla a mano para el paso siguiente.',
      },
      {
        titulo: 'Pega la dirección del webhook en GHL',
        detalle:
          'Copia la dirección que aparece aquí arriba y pégala en GHL, en la automatización que ' +
          'avisa de las citas (Workflows → acción "Webhook", o Settings → Webhooks según tu plan). ' +
          'Método POST. Añade una cabecera llamada x-ghl-secret y, como valor, EXACTAMENTE la misma ' +
          'contraseña del paso 3: se compara carácter a carácter y un espacio de más la invalida.',
      },
      {
        titulo: 'Elige qué eventos envía GHL',
        detalle:
          'Marca al menos: cita creada, cita actualizada (asistió, no asistió, cancelada) y alta de ' +
          'lead. Cada uno de esos avisos es lo que mantiene el CRM al día sin que nadie copie nada ' +
          'a mano.',
      },
      {
        titulo: 'Comprueba que funciona',
        detalle:
          'Crea o mueve una cita de prueba en GHL y mira si aparece en Agendas. Si no aparece, lo ' +
          'más probable es que la contraseña del paso 3 no sea idéntica en los dos sitios.',
      },
    ],
    fields: [
      {
        key: 'GHL_API_TOKEN',
        label: 'Private Integration Token',
        type: 'password',
        secret: true,
        placeholder: 'pit-…',
        help: 'Paso 2. GHL solo lo enseña al crearlo: si lo perdiste, crea otra integración privada.',
      },
      {
        key: 'GHL_LOCATION_ID',
        label: 'Location ID',
        type: 'text',
        secret: false,
        placeholder: 've9EPM428h8vShlRW1KT',
        help: 'Paso 1. Está en la URL de GHL, entre /location/ y la barra siguiente.',
      },
      {
        key: 'GHL_WEBHOOK_SECRET',
        label: 'Webhook Secret (entrante)',
        type: 'password',
        secret: true,
        help: 'Paso 3. La eliges tú, no la da GHL. Debe ser idéntica aquí y en la cabecera x-ghl-secret de GHL.',
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
    description:
      'Motores de la plataforma: generación de contenido, análisis de llamadas, guiones, tareas y transcripción. DeepSeek es uno más — cuando su clave está puesta, atiende el texto; si no, lo hace Anthropic.',
    category: 'ia',
    test: true,
    // El texto funciona con DeepSeek O Anthropic. Groq aporta transcripción, pero no puede hacer que
    // un agente de texto correctamente configurado aparezca como desconectado.
    requiredAny: ['DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY'],
    pasos: [
      {
        titulo: 'Necesitas al menos un proveedor, no todos',
        detalle:
          'Cada clave es de un servicio distinto y basta con una para que el asistente funcione. DeepSeek suele ser el más barato; Anthropic, el más capaz en análisis largos. Puedes empezar con uno y añadir otro después.',
      },
      {
        titulo: 'Crea la clave en el panel del proveedor',
        detalle:
          'DeepSeek en platform.deepseek.com, Anthropic en console.anthropic.com, Groq en console.groq.com. En los tres es el mismo sitio: apartado de API Keys → crear. Se enseñan una sola vez.',
      },
      {
        titulo: 'Pon un límite de gasto antes de repartirlo al equipo',
        detalle:
          'Estas claves se cobran por uso. Casi todos los proveedores permiten fijar un tope mensual: hazlo antes de dejar el asistente en manos de más gente.',
      },
    ],
    fields: [
      {
        key: 'ANTHROPIC_API_KEY',
        label: 'Anthropic API Key',
        type: 'password',
        secret: true,
        placeholder: 'sk-ant-…',
        help: 'Opcional si usas DeepSeek. Motor alternativo para asistentes, contenido, tareas y análisis.',
      },
      {
        key: 'GROQ_API_KEY',
        label: 'Groq API Key',
        type: 'password',
        secret: true,
        placeholder: 'gsk_…',
        help: 'Opcional para el agente. Se usa para transcribir llamadas y reels.',
      },
      {
        // DeepSeek vive AQUÍ y no en su propia tarjeta: es un motor más de los que la plataforma
        // puede usar, no una integración aparte. Tenerlo separado obligaba a configurar la IA en dos
        // sitios y escondía que ambos hacen el mismo trabajo.
        key: 'DEEPSEEK_API_KEY',
        label: 'DeepSeek API Key',
        type: 'password',
        secret: true,
        placeholder: 'sk-…',
        help: 'Opcional. Si la pones, DeepSeek pasa a ser el motor de texto de esta subcuenta. Se guarda cifrada y solo se usa en el servidor.',
      },
      {
        key: 'DEEPSEEK_MODEL',
        advanced: true,
        label: 'Modelo de DeepSeek',
        type: 'text',
        secret: false,
        placeholder: 'Automático',
        help: 'Opcional. Pulsa "Buscar modelos" para elegir entre los que tu clave puede usar de verdad. Vacío = el primero disponible.',
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
    id: 'youtube',
    title: 'YouTube',
    description: 'Publica reels como Shorts y sincroniza sus métricas.',
    category: 'marketing',
    test: true,
    required: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
    pasos: [
      {
        titulo: 'Crea un proyecto en Google Cloud y activa la API de YouTube',
        detalle:
          'En console.cloud.google.com crea un proyecto y, en Biblioteca, activa YouTube Data API v3. Sin activarla ' +
          'las credenciales existen pero toda llamada falla.',
      },
      {
        titulo: 'Crea credenciales de tipo OAuth',
        detalle:
          'Credenciales → Crear → ID de cliente de OAuth, tipo Aplicación web. De ahí salen el Client ID y el ' +
          'Client Secret que van en los campos de abajo.',
      },
      {
        titulo: 'El refresh token sale de autorizar una vez',
        detalle:
          'Es lo que permite seguir publicando sin volver a entrar cada hora. Se obtiene completando el flujo de ' +
          'autorización de Google con esas credenciales. Es el único paso que no se resuelve copiando de un panel: ' +
          'si no lo tienes, pide ayuda para este.',
      },
    ],
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
    pasos: [
      {
        titulo: 'La clave la eliges tú',
        detalle:
          'No viene de ningún proveedor: es una contraseña que protege la entrada de eventos para que nadie pueda inyectar visitas falsas. Usa algo largo y aleatorio.',
      },
      {
        titulo: 'Instala el píxel en tus páginas',
        detalle:
          'En Configuración → Data Health tienes el fragmento de código con la clave PÚBLICA de tu sitio, listo para pegar antes de cerrar la etiqueta body. Es distinto de esta clave: el píxel es público y esta es privada del servidor.',
      },
      {
        titulo: 'Comprueba que llegan visitas',
        detalle:
          'Abre una página tuya y mira el panel de tracking. Si no aparece nada, lo más común es que el dominio no esté dado de alta como sitio permitido.',
      },
    ],
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
    pasos: [
      {
        titulo: 'Crea el proyecto en Google Cloud y activa las APIs',
        detalle:
          'En console.cloud.google.com crea un proyecto y activa en Biblioteca las APIs que vayas a usar: Google Analytics Data para GA4, Gmail API para el correo. Cada una se activa por separado.',
      },
      {
        titulo: 'Crea el ID de cliente de OAuth',
        detalle:
          'Credenciales → Crear → ID de cliente de OAuth, tipo Aplicación web. De ahí salen el Client ID y el Client Secret que van abajo.',
      },
      {
        titulo: 'Da acceso a la propiedad de GA4',
        detalle:
          'Tener credenciales no basta: en Google Analytics la cuenta que autorice necesita al menos permiso de lectura sobre la propiedad. Es el olvido más común y da un error de permisos que parece de credenciales.',
      },
    ],
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
