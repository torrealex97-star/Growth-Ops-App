// CTAs / lead magnets del funnel de contenido. Se usan para (a) el selector
// en la UI y (b) construir el contexto que recibe la IA al generar guiones nichados.
// EDITABLE: sustituye estos CTAs de ejemplo por los tuyos (código, recurso, URL).
// Cada guión mantiene el hook del reel de referencia y termina redirigiendo hacia
// tu oferta con UNO de estos CTAs.

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
    code: 'INFO', label: 'INFO — Hablar directamente (setter)', funnel: 'top', avatar: 'ambos',
    description: 'Abre una conversación directa por DM para hablar con el equipo (responde el setter). No es un vídeo, es iniciar conversación.',
    url: '',
  },
]

export const CTA_CODES = CTAS.map((c) => c.code)

// Texto compacto de los CTAs para inyectar en el prompt de la IA.
export function ctasForPrompt(): string {
  return CTAS.map((c) => `- CTA "${c.code}" (${c.funnel}, avatar ${c.avatar}): ${c.description}${c.url ? ` [recurso: ${c.url}]` : ''}`).join('\n')
}

// Contexto de negocio por defecto (editable en Configuración → Integraciones → Negocio).
// EDITA esto con tu propio negocio, avatares y funnel antes de generar contenido con IA.
export const DEFAULT_BUSINESS_CONTEXT = `NEGOCIO: [describe aquí a qué te dedicas y qué vendes].
AVATARES: [describe los 1-3 perfiles de cliente/lead a los que te diriges].
FUNNEL: top = despertar interés (el QUÉ, no el CÓMO); middle = recurso según avatar; bottom = cierre hacia tu oferta principal.
REGLA DE GUIÓN: mantener SIEMPRE el hook y la primera parte del reel de referencia (el gancho que ya funcionó), y a partir de ahí redirigir de forma natural hacia tu oferta, cerrando con UN CTA (comentar la palabra clave para recibir el recurso).`
