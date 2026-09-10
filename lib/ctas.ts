// Los 6 CTAs / lead magnets del funnel de [tenant]. Se usan para (a) el selector
// en la UI y (b) construir el contexto que recibe la IA al generar guiones nichados.
// Cada guión mantiene el hook del reel de referencia y termina redirigiendo hacia
// nuestro modelo de negocio con UNO de estos CTAs.

export type Cta = {
  code: string          // palabra clave que el usuario comenta (CTA)
  label: string
  funnel: 'top' | 'middle' | 'bottom'
  avatar: 'ambos' | 'agencia' | 'negocio'
  description: string   // qué entrega / qué promete
  url: string           // recurso al que apunta
}

export const CTAS: Cta[] = [
  {
    code: 'AGENCIA', label: 'AGENCIA — Qué es una Agencia de IA', funnel: 'top', avatar: 'agencia',
    description: 'Vídeo que explica qué es una Agencia de IA (visión general, el QUÉ no el CÓMO).',
    url: 'https://youtu.be/zV5YeQmmC-Y',
  },
  {
    code: 'INFO', label: 'INFO — Hablar directamente (setter)', funnel: 'top', avatar: 'ambos',
    description: 'Abre una conversación directa por DM para hablar con el equipo (responde el setter). No es un vídeo, es iniciar conversación.',
    url: '',
  },
  {
    code: 'NEGOCIO', label: 'NEGOCIO — Formación modelo Agencia IA', funnel: 'middle', avatar: 'agencia',
    description: 'Formación completa para entender el modelo de negocio de una Agencia de IA.',
    url: 'https://www.youtube.com/watch?v=e4spf6tu6Rs&list=PLZkwnvAWoYF_GIzUqtxZVslRjMcSK6j-a',
  },
  {
    code: 'CLIENTES', label: 'CLIENTES — Sistema para captar clientes con IA', funnel: 'middle', avatar: 'agencia',
    description: 'Vídeo paso a paso de un sistema para conseguir clientes de forma automática con IA.',
    url: 'https://youtu.be/aXwqnR5GsCQ',
  },
  {
    code: 'VIDEO', label: 'VIDEO — Empezar tu Agencia IA (sistema [tenant])', funnel: 'bottom', avatar: 'agencia',
    description: 'Vídeo que muestra cómo empezar tu Agencia de IA con el sistema [tenant], con el que hemos escalado a +50k/mes y formado a cientos de personas.',
    url: 'https://youtu.be/Kk4y9y1QSIA',
  },
  {
    code: 'CLASE', label: 'CLASE — Clase para empezar hoy tu Agencia IA', funnel: 'bottom', avatar: 'agencia',
    description: 'Vídeo-clase donde se muestra cómo empezar hoy mismo tu Agencia de IA online (VSL).',
    url: 'https://tu-dominio.com/vsl',
  },
]

export const CTA_CODES = CTAS.map((c) => c.code)

// Texto compacto de los CTAs para inyectar en el prompt de la IA.
export function ctasForPrompt(): string {
  return CTAS.map((c) => `- CTA "${c.code}" (${c.funnel}, avatar ${c.avatar}): ${c.description}${c.url ? ` [recurso: ${c.url}]` : ''}`).join('\n')
}

// Contexto de negocio por defecto (editable en app_settings → ig_business_context).
export const DEFAULT_BUSINESS_CONTEXT = `NEGOCIO: [tenant] — enseñamos a montar y escalar una Agencia de IA (vender servicios de IA/automatización a empresas) y a implementar IA en negocios.
AVATARES: (1) "agencia": quiere montar/escalar su propia agencia de IA; (2) "negocio": quiere implementar IA para automatizar y mejorar su negocio.
FUNNEL: top = despertar interés (el QUÉ, no el CÓMO); middle = recurso según avatar; bottom = cierre hacia la academia/VSL.
REGLA DE GUIÓN: mantener SIEMPRE el hook y la primera parte del reel de referencia (el gancho que ya funcionó), y a partir de ahí redirigir de forma natural hacia nuestro modelo de negocio, cerrando con UN CTA (comentar la palabra clave para recibir el recurso).`
