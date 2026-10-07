import { huellaEvento } from './ghl'

// F1 — CAPA EN BRUTO Y HECHO CANÓNICO DEL WEBHOOK DE WHOP.
//
// Igual que Hotmart, pero con el sobre de Standard Webhooks de Whop:
//   { id: "msg_…", type: "payment.succeeded", timestamp, account_id|company_id, data: { … } }
//
// LO QUE NO HACE: decidir qué producto de la app es el producto de Whop. El pago trae el producto
// EXTERNO y su importe; el mapeo a producto/plan de la app es una decisión del propietario. Igual
// que Stripe, la ingesta guarda el HECHO; el registro financiero pasa por una decisión humana.
//
// LOS IMPORTES SE TRANSCRIBEN TAL CUAL. Whop manda `total`/`currency`; este módulo NO convierte
// unidades ni divisa: `importe_declarado` es lo que Whop dijo, con su moneda. Inventar una
// conversión (¿céntimos?, ¿unidades?) sería fabricar dinero que nadie verificó.

export type PayloadWhop = Record<string, unknown>

export const NORMALIZADOR_WHOP = 'whop-1'

const esObjeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const texto = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Identificador del evento EN WHOP, base de la idempotencia.
 *
 * El sobre trae `id` (el mismo `msg_…` de la cabecera `webhook-id`; Whop reenvía cada entrega con
 * el MISMO id). Sin id en el cuerpo se usa la cabecera; sin ninguna, huella determinista del
 * contenido que define el hecho.
 */
export function idEventoWhop(payload: PayloadWhop, idCabecera?: string | null): string {
  const idReal = texto(payload.id) ?? texto(idCabecera ?? null)
  if (idReal) return idReal
  const d = esObjeto(payload.data)
  return `hf_${huellaEvento({
    tipo: texto(payload.type),
    pago: texto(d?.id),
    miembro: texto(esObjeto(d?.membership)?.id),
    timestamp: texto(payload.timestamp),
  })}`
}

const MAPEO_EVENTOS: Record<string, string> = {
  // Documentados en docs.whop.com (tabla de eventos). Lo que no esté aquí cae en
  // `whop.evento.recibido`: guardar lo desconocido sin inventarle semántica es la regla.
  'payment.succeeded': 'whop.pago.recibido',
  'payment.failed': 'whop.pago.fallido',
  'refund.created': 'whop.reembolso.creado',
  'membership.activated': 'whop.miembro.activado',
  'member.created': 'whop.miembro.creado',
}

/** Clase económica del hecho. Solo se declara; SUMAR dinero lo decide el registro humano. */
export type ClaseCompra = 'dinero' | 'devolucion' | 'estado'

export function claseEventoWhop(tipo: string): ClaseCompra {
  if (tipo === 'payment.succeeded') return 'dinero'
  if (tipo === 'refund.created') return 'devolucion'
  return 'estado'
}

export function tipoEventoWhop(payload: PayloadWhop): string {
  const tipo = texto(payload.type) ?? ''
  return MAPEO_EVENTOS[tipo] ?? 'whop.evento.recibido'
}

/** CUÁNDO ocurrió: el momento del pago (`paid_at`) y no el del reintento. */
export function ocurridoEnWhop(payload: PayloadWhop, recibidoEn: string): string {
  const d = esObjeto(payload.data) ?? {}
  for (const v of [texto(d.paid_at), texto(d.created_at), texto(payload.timestamp)]) {
    if (!v) continue
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  return recibidoEn
}

export function propiedadesWhop(payload: PayloadWhop): Record<string, unknown> {
  const tipo = texto(payload.type) ?? ''
  const d = esObjeto(payload.data) ?? {}
  const producto = esObjeto(d.product)

  const props: Record<string, unknown> = {
    tipo_whop: tipo,
    clase: claseEventoWhop(tipo),
  }
  const pagoId = texto(d.id)
  if (pagoId) props.pago_id = pagoId
  const estado = texto(d.status)
  if (estado) props.estado_whop = estado
  const productoId = texto(producto?.id)
  if (productoId) props.producto_id_externo = productoId
  const productoNombre = texto(producto?.title)
  if (productoNombre) props.producto_nombre = productoNombre
  const miembroId = texto(esObjeto(d.membership)?.id)
  if (miembroId) props.membresia_id = miembroId
  const importe = numero(d.total)
  if (importe !== null) props.importe_declarado = importe
  const moneda = texto(d.currency)
  if (moneda) props.moneda = moneda
  return props
}

/** Todo lo que el webhook necesita para procesar una entrega de Whop. `null` = no se entiende. */
export function derivarWhop(
  payload: unknown,
  recibidoEn: string,
  idCabecera?: string | null
): {
  sourceEventId: string
  tipo: string
  ocurridoEn: string
  propiedades: Record<string, unknown>
  clase: ClaseCompra
} | null {
  if (!payload || typeof payload !== 'object') return null
  if (!texto((payload as PayloadWhop).type)) return null
  const p = payload as PayloadWhop
  return {
    sourceEventId: idEventoWhop(p, idCabecera),
    tipo: tipoEventoWhop(p),
    ocurridoEn: ocurridoEnWhop(p, recibidoEn),
    propiedades: propiedadesWhop(p),
    clase: claseEventoWhop(texto(p.type) ?? ''),
  }
}

/**
 * El comprador, para encajar el contacto. Sale de `data.user` y NUNCA entra en las propiedades del
 * hecho (el sobre completo ya vive en raw_events con su control de acceso).
 */
export function compradorWhop(payload: PayloadWhop): {
  email: string | null
  fullName: string | null
  phone: string | null
} {
  const d = esObjeto(payload.data) ?? {}
  const user = esObjeto(d.user)
  const email = texto(user?.email)?.toLowerCase() ?? null
  const fullName = texto(user?.name)
  const phone = texto(d.customer_phone)
  return { email, fullName, phone }
}

/** Payload reesculpido para leerToque: `data` a la raíz, por si Whop incluye parámetros UTM. */
export function toqueDesdePayloadWhop(payload: PayloadWhop): Record<string, unknown> {
  return esObjeto(payload.data) ?? {}
}

export const TIPOS_DE_EVENTO_WHOP = [
  { nombre: 'whop.pago.recibido', descripcion: 'Whop confirma un pago exitoso.' },
  { nombre: 'whop.pago.fallido', descripcion: 'Whop comunica un pago fallido.' },
  { nombre: 'whop.reembolso.creado', descripcion: 'Whop comunica un reembolso.' },
  { nombre: 'whop.miembro.activado', descripcion: 'Whop comunica una membresía activada.' },
  { nombre: 'whop.miembro.creado', descripcion: 'Whop comunica un alta de miembro.' },
  { nombre: 'whop.evento.recibido', descripcion: 'Evento de Whop recibido y guardado, sin clasificar todavía.' },
] as const
