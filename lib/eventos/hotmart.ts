import { huellaEvento } from './ghl'

// F1 — CAPA EN BRUTO Y HECHO CANÓNICO DEL WEBHOOK DE HOTMART.
//
// Hotmart es el canal de cobro de muchos productos digitales: cuando alguien compra, Hotmart llama
// al webhook con la compra entera. Este módulo es PURA (nada de red ni base de datos): identifica
// el evento, lo clasifica y extrae sus propiedades — el webhook (lib/webhooks/entradaCompras.ts)
// hace el resto.
//
// LO QUE NO HACE: decidir qué producto de la app es el producto de Hotmart. La compra trae el
// producto EXTERNO (id y nombre de Hotmart) y su importe; el mapeo a producto/plan de la app es
// una decisión del propietario. Igual que Stripe, la ingesta guarda el HECHO; el registro
// financiero pasa por una decisión humana.
//
// FORMATO DEL PAYLOAD (v2, JSON):
//   { id, creation_date, event: "PURCHASE_APPROVED", version, data: {
//       buyer: { email, name, ... },              ← PII: nunca entra en propiedades
//       product: { id, name },
//       purchase: { transaction, status, order_date, approved_date, price: { value, currency_value } } } }

export type PayloadHotmart = Record<string, unknown>

export const NORMALIZADOR_HOTMART = 'hotmart-1'

const esObjeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const texto = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Identificador del evento EN HOTMART, base de la idempotencia.
 *
 * El sobre v2 trae `id` de evento propio. Los payloads que no lo traen (entregas antiguas o
 * reenvíos de la UI) se identifican por huella determinista del CONTENIDO que define el hecho —
 * evento + transacción + fechas de la compra: dos entregas distintas del mismo hecho dan la MISMA
 * huella (el reintento es inofensivo), y dos hechos distintos nunca comparten huella.
 *
 * `hf_` delante distingue en la base una huella de un id real de Hotmart.
 */
export function idEventoHotmart(payload: PayloadHotmart): string {
  const idReal = texto(payload.id)
  if (idReal) return idReal
  const compra = esObjeto(esObjeto(payload.data)?.purchase)
  return `hf_${huellaEvento({
    evento: texto(payload.event),
    transaccion: texto(compra?.transaction),
    order_date: texto(compra?.order_date),
    approved_date: texto(compra?.approved_date),
    estado: texto(compra?.status),
  })}`
}

const MAPEO_EVENTOS: Record<string, string> = {
  // Nombres de evento documentados por Hotmart (purchase-webhook). Lo que no esté aquí cae en
  // `hotmart.evento.recibido`: guardar lo desconocido sin inventarle semántica es la regla.
  PURCHASE_APPROVED: 'hotmart.compra.aprobada',
  PURCHASE_COMPLETE: 'hotmart.compra.completa',
  PURCHASE_REFUNDED: 'hotmart.compra.reembolsada',
  PURCHASE_CHARGEBACK: 'hotmart.compra.disputa',
  PURCHASE_PROTEST: 'hotmart.compra.disputa',
  PURCHASE_CANCELED: 'hotmart.compra.cancelada',
  PURCHASE_EXPIRED: 'hotmart.compra.expirada',
  PURCHASE_DELAYED: 'hotmart.compra.retrasada',
  PURCHASE_BILLET_PRINTED: 'hotmart.compra.recibo',
}

/** Clase económica del hecho. Solo se declara; SUMAR dinero lo decide el registro humano. */
export type ClaseCompra = 'dinero' | 'devolucion' | 'estado'

export function claseEventoHotmart(evento: string): ClaseCompra {
  if (evento === 'PURCHASE_APPROVED' || evento === 'PURCHASE_COMPLETE') return 'dinero'
  if (evento === 'PURCHASE_REFUNDED' || evento === 'PURCHASE_CHARGEBACK' || evento === 'PURCHASE_PROTEST')
    return 'devolucion'
  return 'estado'
}

export function tipoEventoHotmart(payload: PayloadHotmart): string {
  const evento = texto(payload.event)?.toUpperCase() ?? ''
  return MAPEO_EVENTOS[evento] ?? 'hotmart.evento.recibido'
}

/**
 * CUÁNDO ocurrió la compra, que no es cuándo nos llegó. `order_date` es la fecha del pedido;
 * `approved_date` la de la aprobación del pago; `creation_date` (segundos) la del evento en sí.
 * Solo si no hay ninguna se cae a la fecha de recepción.
 */
export function ocurridoEnHotmart(payload: PayloadHotmart, recibidoEn: string): string {
  const compra = esObjeto(esObjeto(payload.data)?.purchase)
  for (const v of [texto(compra?.order_date), texto(compra?.approved_date)]) {
    if (!v) continue
    const t = Date.parse(v)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
  }
  const creacion = numero(payload.creation_date)
  // creation_date llega en segundos desde época (~1.7e9 hoy). Un rango acotado evita interpretar
  // como fecha un número que en realidad es otra cosa (un importe mal colocado, por ejemplo).
  if (creacion !== null && creacion > 1_000_000_000 && creacion < 4_000_000_000) {
    return new Date(creacion * 1000).toISOString()
  }
  return recibidoEn
}

export function propiedadesHotmart(payload: PayloadHotmart): Record<string, unknown> {
  const evento = texto(payload.event)?.toUpperCase() ?? ''
  const d = esObjeto(payload.data)
  const compra = esObjeto(d?.purchase)
  const producto = esObjeto(d?.product)
  const precio = esObjeto(compra?.price)

  const props: Record<string, unknown> = {
    tipo_hotmart: evento || null,
    clase: claseEventoHotmart(evento),
  }
  const transaccion = texto(compra?.transaction)
  if (transaccion) props.transaccion = transaccion
  const estado = texto(compra?.status)
  if (estado) props.estado_hotmart = estado
  const productoId = texto(producto?.id) ?? numero(producto?.id)?.toString() ?? null
  if (productoId) props.producto_id_externo = productoId
  const productoNombre = texto(producto?.name)
  if (productoNombre) props.producto_nombre = productoNombre
  const importe = numero(precio?.value)
  if (importe !== null) props.importe_declarado = importe
  const moneda = texto(precio?.currency_value)
  if (moneda) props.moneda = moneda
  return props
}

/** Todo lo que el webhook necesita para procesar una entrega de Hotmart. `null` = no se entiende. */
export function derivarHotmart(
  payload: unknown,
  recibidoEn: string
): {
  sourceEventId: string
  tipo: string
  ocurridoEn: string
  propiedades: Record<string, unknown>
  clase: ClaseCompra
} | null {
  if (!payload || typeof payload !== 'object') return null
  if (!texto((payload as PayloadHotmart).event)) return null
  const p = payload as PayloadHotmart
  return {
    sourceEventId: idEventoHotmart(p),
    tipo: tipoEventoHotmart(p),
    ocurridoEn: ocurridoEnHotmart(p, recibidoEn),
    propiedades: propiedadesHotmart(p),
    clase: claseEventoHotmart(texto(p.event)?.toUpperCase() ?? ''),
  }
}

/**
 * El comprador, para encajar el contacto. Sale de `data.buyer` y NUNCA entra en las propiedades
 * del hecho (el sobre completo ya vive en raw_events con su control de acceso — duplicar la
 * identidad del comprador en una tabla de analítica multiplica dónde hay que ir a borrarla).
 *
 * Sin teléfono: el buyer de Hotmart no lo trae de forma documentada, y encajar el contacto por
 * un campo "por si acaso" es exactamente el patrón que corrompe datos (la regla de la casa: ante
 * la duda, no se decide). El email basta.
 */
export function compradorHotmart(payload: PayloadHotmart): {
  email: string | null
  fullName: string | null
  phone: string | null
} {
  const buyer = esObjeto(esObjeto(payload.data)?.buyer)
  const email = texto(buyer?.email)?.toLowerCase() ?? null
  const fullName = texto(buyer?.name)
  return { email, fullName, phone: null }
}

/** Payload reesculpido para leerToque: `data` a la raíz y el `tracking` de la compra si existe. */
export function toqueDesdePayloadHotmart(payload: PayloadHotmart): Record<string, unknown> {
  const d = esObjeto(payload.data) ?? {}
  const compra = esObjeto(d.purchase) ?? {}
  return {
    ...d,
    ...compra,
    tracking: esObjeto(compra.tracking) ?? esObjeto(d.tracking) ?? {},
  }
}

export const TIPOS_DE_EVENTO_HOTMART = [
  { nombre: 'hotmart.compra.aprobada', descripcion: 'Hotmart confirma una compra aprobada.' },
  { nombre: 'hotmart.compra.completa', descripcion: 'Hotmart confirma la entrega completa de una compra.' },
  { nombre: 'hotmart.compra.reembolsada', descripcion: 'Hotmart comunica un reembolso.' },
  { nombre: 'hotmart.compra.disputa', descripcion: 'Hotmart comunica una disputa o protesta.' },
  { nombre: 'hotmart.compra.cancelada', descripcion: 'Hotmart comunica una compra cancelada.' },
  { nombre: 'hotmart.compra.expirada', descripcion: 'Hotmart comunica una compra expirada.' },
  { nombre: 'hotmart.compra.retrasada', descripcion: 'Hotmart comunica un pago retrasado.' },
  { nombre: 'hotmart.compra.recibo', descripcion: 'Hotmart comunica la emisión del recibo.' },
  { nombre: 'hotmart.evento.recibido', descripcion: 'Evento de Hotmart recibido y guardado, sin clasificar todavía.' },
] as const
