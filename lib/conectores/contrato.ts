// F2 — EL CONTRATO DE UN CONECTOR.
//
// EL PROBLEMA. Hoy cada integración está escrita a su manera: Stripe pagina con presupuesto de
// tiempo, Calendly no; GHL registra sus ejecuciones, el tracking no; el secreto del webhook lo lee
// cada uno de un sitio distinto (ese fue el fallo de GHL en #127 y el de Calendly en #175). Añadir
// el decimocuarto proveedor significa volver a decidir todo eso, y olvidarse de la mitad.
//
// LO QUE ARREGLA. Un conector DECLARA lo que sabe hacer (el manifiesto) e IMPLEMENTA solo los
// métodos que su proveedor soporta. La suite de contrato (`tests/conectores-contrato.test.mjs`)
// comprueba lo declarado contra lo implementado, así que "soporta webhooks" y "tiene un método para
// recibirlos" no pueden separarse.
//
// LO QUE NO HACE, A PROPÓSITO:
//
//   · **No obliga a implementar lo que el proveedor no tiene** (el plan es explícito). Calendly no
//     ofrece acciones salientes; Apify no distingue clientes. Un método obligatorio que devuelve
//     "no soportado" es peor que no declararlo: obliga a leer el cuerpo para saber si existe.
//   · **No reescribe las integraciones que funcionan.** Los adaptadores envuelven el código ya
//     probado (F2, segundo trozo). El comportamiento observable no cambia: eso es lo que se gradúa.
//   · **`normalize` es PURO.** Sin red, sin base de datos, sin reloj. Es lo que permite probar el
//     trato con un proveedor a partir de un fixture guardado, sin credenciales y sin tocar nada.

import type { SupabaseClient } from '@supabase/supabase-js'

// ── EL MANIFIESTO ────────────────────────────────────────────────────────────────────────────

/** Cómo se autentica el proveedor. `ninguno` = endpoint público firmado (webhooks de plataforma). */
export type ModoAuth = 'api_key' | 'oauth2' | 'secreto_webhook' | 'ninguno'

/** Cómo entran los datos. Un proveedor puede tener varias. */
export type ModoSync = 'webhook' | 'incremental' | 'backfill' | 'manual'

/**
 * Qué sabe hacer el conector. Es un CONTRATO, no una aspiración: la suite comprueba que cada
 * capacidad declarada tiene su método, y —más importante— que un método implementado esté declarado.
 * Un conector que recibe webhooks sin decirlo deja el panel mintiendo sobre cómo entran sus datos.
 */
export type Capacidades = {
  /** Descubrir qué objetos hay disponibles (cuentas publicitarias, calendarios, bibliotecas). */
  discover?: boolean
  /** Traer el histórico de una vez. */
  backfill?: boolean
  /** Traer solo lo nuevo desde el último cursor. */
  incrementalSync?: boolean
  /** Recibir eventos empujados por el proveedor. */
  ingestWebhook?: boolean
  /** Comparar lo que tenemos contra la fuente y reportar diferencias. */
  reconcile?: boolean
  /** Comprobar credenciales y conexión SIN escribir nada. */
  healthCheck?: boolean
  /**
   * Escribir HACIA el proveedor (crear un contacto en GHL, subir un vídeo). Va aparte del resto a
   * propósito: leer es reversible y escribir fuera no. Que sea opcional y explícito obliga a
   * declarar quién puede tocar datos de otro sistema.
   */
  executeAction?: boolean
}

export type ConnectorManifest = {
  /** Id del proveedor. Coincide con el grupo del catálogo de Integraciones y con `raw_events.source`. */
  provider: string
  /** Versión del manifiesto. Sube cuando cambian capacidades o el trato con el proveedor. */
  version: string
  label: string
  authMode: ModoAuth
  /**
   * Claves necesarias para LEER del proveedor. Solo estas deciden si la integración está
   * configurada: sin ellas no hay sincronización posible.
   */
  requiredKeys: string[]
  /**
   * Claves necesarias para VERIFICAR los webhooks entrantes, aparte de `requiredKeys` a propósito.
   *
   * POR QUÉ SEPARADAS. Estaban mezcladas y el panel daba un veredicto falso: Stripe aparecía como
   * "sin configurar" por faltarle el signing secret mientras sincronizaba 74 filas cada hora sin un
   * fallo. Son dos cosas distintas —traer datos y aceptar los que empujan— y se rompen por separado:
   * quien lee la pantalla necesita saber cuál de las dos está rota.
   */
  webhookKeys?: string[]
  /** Qué objetos del negocio produce este conector: `contacts`, `appointments`, `payments`… */
  supportedObjects: string[]
  syncModes: ModoSync[]
  capabilities: Capacidades
  /** Ruta del webhook entrante con `{tenant}` sin rellenar, si lo tiene. */
  webhookPath?: string
  /**
   * Cuántas peticiones por minuto admite el proveedor antes de limitar. Se declara aunque no se use
   * todavía: sin el número, cada sincronización nueva lo vuelve a descubrir a base de errores 429.
   */
  rateLimitPorMinuto?: number
}

// ── LOS MÉTODOS ──────────────────────────────────────────────────────────────────────────────

/** Config de la subcuenta ya descifrada (lo que devuelve `getTenantConfigWithFallback`). */
export type ConfigConector = Record<string, string | undefined>

export type ContextoConector = {
  sb: SupabaseClient
  tenantId: string
  cfg: ConfigConector
  /**
   * Momento (epoch ms) en que hay que rendirse. Una función de Vercel muere a los 60 s: sin este
   * presupuesto, una sincronización larga se corta a mitad sin dejar cursor ni explicación.
   */
  deadline?: number
}

/** Dónde se quedó la última pasada. `null` = empezar por el principio. */
export type Cursor = { valor: string; recibidoEn?: string } | null

export type ResultadoSync = {
  /** Filas escritas o refrescadas. */
  escritos: number
  /** `true` = quedaban más datos en el proveedor; se sigue en la próxima pasada. */
  truncado: boolean
  cursor: Cursor
  /** Qué NO se pudo traer y por qué. Vacío no es lo mismo que "todo bien". */
  incidencias: string[]
}

export type ResultadoSalud = {
  ok: boolean
  /** Una frase para la pantalla. Nunca un código ni el cuerpo crudo del proveedor. */
  mensaje: string
  /** Pista estable para ofrecer el arreglo concreto sin parsear el mensaje. */
  codigo?: string
}

/**
 * Un evento normalizado, listo para la capa de eventos de F1. `normalize` devuelve esto y NADA más:
 * sin escribir, sin decidir si cuenta como dinero, sin tocar proyecciones.
 */
export type EventoNormalizado = {
  sourceEventId: string
  tipo: string
  ocurridoEn: string
  propiedades: Record<string, unknown>
}

/**
 * Lo que un conector puede implementar. **Todo es opcional**: lo que manda es el manifiesto, y la
 * suite de contrato comprueba que declaración e implementación coinciden en los dos sentidos.
 */
export type Conector = {
  manifest: ConnectorManifest

  /** Autenticación, cuando el proveedor la necesita (OAuth). */
  authorize?: (ctx: ContextoConector, codigo: string) => Promise<ResultadoSalud>
  refresh?: (ctx: ContextoConector) => Promise<ResultadoSalud>
  revoke?: (ctx: ContextoConector) => Promise<ResultadoSalud>

  /** Qué objetos ofrece esta cuenta (cuentas publicitarias, calendarios…). */
  discover?: (ctx: ContextoConector) => Promise<{ objetos: { id: string; label: string }[] }>

  backfill?: (ctx: ContextoConector, rango: { desde: string; hasta: string }) => Promise<ResultadoSync>
  incrementalSync?: (ctx: ContextoConector, cursor: Cursor) => Promise<ResultadoSync>

  /**
   * Recibe el cuerpo crudo de un webhook y devuelve el evento normalizado. NO escribe: quien llama
   * guarda primero el sobre en bruto (F1) y luego decide. `null` = no se entiende este payload.
   */
  ingestWebhook?: (crudo: unknown, cabeceras: Record<string, string | null>) => EventoNormalizado | null

  /** PURO: mismo payload, mismo resultado. Sin red, sin base, sin reloj. */
  normalize?: (crudo: unknown) => EventoNormalizado | null

  /** Compara lo guardado contra la fuente y reporta diferencias. No arregla por su cuenta. */
  reconcile?: (ctx: ContextoConector, rango: { desde: string; hasta: string }) => Promise<{ diferencias: string[] }>

  healthCheck?: (ctx: ContextoConector) => Promise<ResultadoSalud>

  /**
   * Escritura HACIA el proveedor. Aparte del resto y con metadatos obligatorios: quién la originó y
   * con qué correlación, para poder responder "¿por qué se creó esto ahí?" meses después.
   */
  executeAction?: (
    ctx: ContextoConector,
    accion: { nombre: string; datos: Record<string, unknown>; origen: string; correlacion: string }
  ) => Promise<ResultadoSalud>
}

// ── DECLARADO vs IMPLEMENTADO ────────────────────────────────────────────────────────────────

/** Métodos cuya presencia debe coincidir con la capacidad del mismo nombre. */
export const METODOS_DE_CAPACIDAD = [
  'discover',
  'backfill',
  'incrementalSync',
  'ingestWebhook',
  'reconcile',
  'healthCheck',
  'executeAction',
] as const

export type Desajuste = { metodo: string; problema: 'declarado_sin_implementar' | 'implementado_sin_declarar' }

/**
 * Comprueba el manifiesto contra la implementación, en los DOS sentidos.
 *
 * El sentido que suele olvidarse es el segundo: un conector que implementa `executeAction` sin
 * declararlo puede escribir en el sistema de un cliente sin que el panel lo diga en ninguna parte.
 */
export function desajustes(conector: Conector): Desajuste[] {
  const fuera: Desajuste[] = []
  for (const metodo of METODOS_DE_CAPACIDAD) {
    const declarado = conector.manifest.capabilities[metodo] === true
    const implementado = typeof (conector as Record<string, unknown>)[metodo] === 'function'
    if (declarado && !implementado) fuera.push({ metodo, problema: 'declarado_sin_implementar' })
    if (!declarado && implementado) fuera.push({ metodo, problema: 'implementado_sin_declarar' })
  }
  return fuera
}

/** Errores del manifiesto en sí: lo que haría imposible confiar en él. */
export function erroresDeManifiesto(m: ConnectorManifest): string[] {
  const errores: string[] = []
  if (!/^[a-z0-9_]+$/.test(m.provider)) errores.push('provider: solo minúsculas, números y guion bajo')
  if (!/^\d+\.\d+$/.test(m.version)) errores.push('version: formato mayor.menor, p. ej. "1.0"')
  if (!m.label.trim()) errores.push('label: hace falta un nombre para la pantalla')
  if (m.syncModes.length === 0) errores.push('syncModes: un conector que no declara cómo entran los datos no sirve')
  if (m.supportedObjects.length === 0) errores.push('supportedObjects: hay que declarar qué produce')
  if (m.capabilities.ingestWebhook && !m.webhookPath) {
    errores.push('capabilities.ingestWebhook sin webhookPath: la pantalla no podría enseñar la dirección')
  }
  if (m.webhookPath && !/^\/api\/(\{tenant\}|webhooks)\//.test(m.webhookPath)) {
    errores.push('webhookPath: debe empezar por /api/{tenant}/ o /api/webhooks/')
  }
  if (m.authMode !== 'ninguno' && m.requiredKeys.length === 0) {
    errores.push('requiredKeys: un conector que se autentica necesita declarar con qué')
  }
  return errores
}
