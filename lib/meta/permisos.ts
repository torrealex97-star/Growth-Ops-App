// LOS 14 ÁMBITOS (PERMISOS) DE LA APP DE META, Y QUÉ HACE LA APP CON CADA UNO.
//
// POR QUÉ EXISTE. Un permiso concedido en el token no significa que la app lo use: Meta lo concede o no
// con independencia de si hay una sola llamada que lo necesite. Sin este inventario, «tenemos 14
// permisos» se leía como «tenemos 14 capacidades», y las pantallas «Sin comprobar» o «conectada pero
// sin sincronizar» parecían falta de implementación cuando eran un token caducado.
//
// CADA ENTRADA `en_uso` CITA UNA PRUEBA EN EL CÓDIGO (`evidencia`: fichero + fragmento) que
// `tests/meta-permisos.test.mjs` comprueba que sigue existiendo. Si alguien borra la llamada, el test
// falla en lugar de dejar este inventario mintiendo.
//
// «Concedido sin uso» no es un defecto: es lo honesto. Varios de ellos son ESCRITURAS sobre cuentas de
// un cliente (publicar, responder, enviar, tocar campañas). Se implementan solo con decisión explícita
// de quién puede hacerlas y con registro de auditoría, nunca «porque el permiso ya está».

export type EstadoAmbito = 'en_uso' | 'concedido_sin_uso' | 'implicito'
export type GrupoMeta = 'meta' | 'instagram'

export type AmbitoMeta = {
  ambito: string
  /** Qué permite hacer, en una frase. */
  capacidad: string
  estado: EstadoAmbito
  /** Llamadas de la Graph API que lo necesitan (las implementadas hoy, o las que lo usarían). */
  endpoints: string[]
  /** Solo si `en_uso`: dónde está la llamada, y un fragmento literal que el test busca. */
  evidencia?: { fichero: string; fragmento: string }
  /** Sin este permiso la integración del grupo no puede funcionar: la comprobación de salud lo exige. */
  obligatorioPara: GrupoMeta[]
  nota?: string
}

export const AMBITOS_META: AmbitoMeta[] = [
  {
    ambito: 'ads_read',
    capacidad: 'Leer gasto, campañas, anuncios y resultados de las cuentas publicitarias.',
    estado: 'en_uso',
    endpoints: ['/me/adaccounts', '/{act}/campaigns', '/{act}/insights', '/{act}/ads'],
    evidencia: { fichero: 'lib/meta/client.ts', fragmento: '/insights' },
    obligatorioPara: ['meta'],
  },
  {
    ambito: 'ads_management',
    capacidad: 'Crear, editar y pausar campañas y anuncios.',
    estado: 'concedido_sin_uso',
    endpoints: ['POST /{act}/campaigns', 'POST /{campaign}'],
    obligatorioPara: [],
    nota: 'La app solo LEE gasto. Tocar la inversión publicitaria de un cliente exige decidir quién puede y con qué aprobación.',
  },
  {
    ambito: 'business_management',
    capacidad: 'Listar los Business Managers y sus cuentas publicitarias y Páginas.',
    estado: 'concedido_sin_uso',
    endpoints: ['/me/businesses', '/{business}/owned_ad_accounts'],
    obligatorioPara: [],
    nota: 'Hace falta para cuentas que son del Business Manager y no del usuario; hoy `/me/adaccounts` basta si el token ya las ve.',
  },
  {
    ambito: 'pages_show_list',
    capacidad: 'Listar las Páginas de Facebook a las que el token tiene acceso.',
    estado: 'en_uso',
    endpoints: ['/me/accounts'],
    evidencia: { fichero: 'lib/instagram/client.ts', fragmento: '/me/accounts' },
    obligatorioPara: ['instagram'],
    nota: 'Es lo que permite llegar de la Página a la cuenta de Instagram vinculada.',
  },
  {
    ambito: 'pages_read_engagement',
    capacidad: 'Leer contenido y datos de las Páginas, y obtener el token de cada una.',
    estado: 'en_uso',
    endpoints: ['/{page}?fields=access_token', '/{page}/video_reels'],
    evidencia: { fichero: 'lib/instagram/client.ts', fragmento: 'access_token' },
    obligatorioPara: ['instagram'],
  },
  {
    ambito: 'pages_manage_metadata',
    capacidad: 'Suscribir la Página a webhooks y gestionar sus ajustes.',
    estado: 'concedido_sin_uso',
    endpoints: ['POST /{page}/subscribed_apps'],
    obligatorioPara: [],
    nota: 'Sin webhooks de Meta, los mensajes y comentarios se consultan, no llegan en tiempo real.',
  },
  {
    ambito: 'pages_messaging',
    capacidad: 'Leer y enviar mensajes de las Páginas.',
    estado: 'en_uso',
    endpoints: ['/{page}/conversations'],
    evidencia: { fichero: 'lib/instagram/client.ts', fragmento: '/conversations' },
    obligatorioPara: [],
    nota: 'Solo LECTURA (contadores y transcripciones para el análisis de setting). Enviar mensajes no está implementado.',
  },
  {
    ambito: 'instagram_basic',
    capacidad: 'Leer el perfil y las publicaciones de la cuenta de Instagram.',
    estado: 'en_uso',
    endpoints: ['/{ig}', '/{ig}/media'],
    evidencia: { fichero: 'lib/instagram/client.ts', fragmento: '/media?fields=' },
    obligatorioPara: ['instagram'],
  },
  {
    ambito: 'instagram_manage_insights',
    capacidad: 'Leer alcance, interacciones y audiencia de la cuenta y de cada publicación.',
    estado: 'en_uso',
    endpoints: ['/{ig}/insights', '/{media}/insights'],
    evidencia: { fichero: 'lib/instagram/client.ts', fragmento: '/insights' },
    obligatorioPara: ['instagram'],
  },
  {
    ambito: 'instagram_manage_messages',
    capacidad: 'Leer y enviar mensajes directos de Instagram.',
    estado: 'en_uso',
    endpoints: ['/{page}/conversations?platform=instagram'],
    evidencia: { fichero: 'lib/instagram/client.ts', fragmento: 'fetchIgConversationsWithMessages' },
    obligatorioPara: [],
    nota: 'Solo LECTURA de conversaciones. Enviar DMs desde la app no está implementado (responder se hace en GHL).',
  },
  {
    ambito: 'instagram_manage_comments',
    capacidad: 'Leer y moderar los comentarios de las publicaciones.',
    estado: 'concedido_sin_uso',
    endpoints: ['/{media}/comments', 'POST /{comment}/replies', 'POST /{comment}?hide=true'],
    obligatorioPara: [],
    nota: 'Hoy solo se guarda el NÚMERO de comentarios (`comments_count`); no se lee su contenido.',
  },
  {
    ambito: 'instagram_manage_engagement',
    capacidad: 'Responder y gestionar la interacción: menciones, respuestas a comentarios.',
    estado: 'concedido_sin_uso',
    endpoints: ['/{ig}/tags', '/{ig}/mentioned_comment'],
    obligatorioPara: [],
  },
  {
    ambito: 'instagram_content_publish',
    capacidad: 'Publicar fotos, vídeos, reels y carruseles en la cuenta de Instagram.',
    estado: 'concedido_sin_uso',
    endpoints: ['POST /{ig}/media', 'POST /{ig}/media_publish', '/{ig}/content_publishing_limit'],
    obligatorioPara: [],
    nota: 'Publicar actúa en público sobre la marca de un cliente: exige aprobación explícita y registro.',
  },
  {
    ambito: 'public_profile',
    capacidad: 'Identificar al usuario o System User dueño del token (`/me`).',
    estado: 'implicito',
    endpoints: ['/me'],
    obligatorioPara: [],
  },
]

/** Ámbitos sin los cuales la integración del grupo NO funciona. */
export function ambitosObligatorios(grupo: GrupoMeta): string[] {
  return AMBITOS_META.filter((a) => a.obligatorioPara.includes(grupo)).map((a) => a.ambito)
}

export type ResumenAmbitos = {
  concedidos: string[]
  /** Obligatorios del grupo que el token NO tiene: la integración no puede funcionar. */
  faltanObligatorios: string[]
  /** Conocidos por la app que el token no tiene (informativo: no impide nada que ya se haga). */
  faltanOpcionales: string[]
  /** El token trae permisos que esta matriz no conoce: conviene revisarlos. */
  desconocidos: string[]
}

/** PURO. Contrasta los ámbitos que Meta dice que tiene el token con lo que la app necesita. */
export function resumirAmbitos(concedidos: string[], grupo: GrupoMeta): ResumenAmbitos {
  const tiene = new Set(concedidos)
  const conocidos = new Set(AMBITOS_META.map((a) => a.ambito))
  const obligatorios = ambitosObligatorios(grupo)
  return {
    concedidos: [...tiene].sort(),
    faltanObligatorios: obligatorios.filter((a) => !tiene.has(a)),
    faltanOpcionales: AMBITOS_META.map((a) => a.ambito).filter((a) => !tiene.has(a) && !obligatorios.includes(a)),
    desconocidos: [...tiene].filter((a) => !conocidos.has(a)).sort(),
  }
}
