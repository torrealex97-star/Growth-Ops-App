// Sincronización de agendas hacia creatuagente (CRM del funnel de Setting IA).
// El lead llega con un `token` (utm_content) inyectado por creatuagente en el enlace
// de Calendly; con ese token identifican al contacto en su lado, así que solo podemos
// notificar las citas que tengan utm_content. Fire-and-forget: nunca debe tumbar el
// flujo de agendas de la app si creatuagente está caído o cambia de esquema.
import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// Igual que las citas, una venta solo se puede notificar si el lead llegó con el token
// (utm_content) de creatuagente. La venta no lo guarda directamente: sale por la agenda
// que la originó (sales.appointment_id -> appointments.utm_content).
export async function resolveSaleToken(
  sb: SupabaseClient,
  appointmentId: string | null | undefined
): Promise<string | null> {
  if (!appointmentId) return null
  const { data } = await sb.from('appointments').select('utm_content').eq('id', appointmentId).maybeSingle()
  return (data?.utm_content as string | null) ?? null
}

export type CreatuagenteEvento =
  'cita.agendada' | 'cita.reprogramada' | 'cita.cancelada' | 'cita.completada' | 'cita.no_asistio'

// Mapeo de estado interno de appointments -> evento de creatuagente. `scheduled`/`confirmed`/
// `reserva` se omiten: ya se notifican como cita.agendada al crear la agenda (webhook Calendly).
export const EVENTO_BY_STATUS: Record<string, CreatuagenteEvento | undefined> = {
  show: 'cita.completada',
  completed: 'cita.completada',
  seguimiento: 'cita.completada',
  no_show: 'cita.no_asistio',
  cancelled: 'cita.cancelada',
  cancelled_admin: 'cita.cancelada',
  cancelled_lead: 'cita.cancelada',
}

export type CreatuagenteCita = {
  idExternoEvento: string
  origen?: string
  inicio?: string
  fin?: string
  titulo?: string
  notas?: string
}

// Esquema de venta.registrada confirmado con creatuagente (2026-09-07): el sobre NO sigue
// el mismo formato {evento, token, cita} que las citas — va {evento, idExterno, venta}, sin
// campo "token". `idExterno` (top-level) es el identificador con el que creatuagente busca
// al contacto; de momento devuelve "contacto_desconocido" tanto con el token (utm_content)
// como con el teléfono, pendiente de que creatuagente confirme qué esperan exactamente.
// Se deja montado con el token (mismo identificador que ya funciona para las citas) a la
// espera de esa confirmación.
export type CreatuagenteVentaRegistrada = {
  importe: number
  moneda: string
  fecha: string
  notas?: string
  idExterno: string // id interno de la venta en nuestro sistema (sales.id)
}

// Formatea una fecha ISO (UTC) al huso horario indicado, con offset explícito
// (p.ej. 2026-09-07T18:00:00+02:00), que es lo que exige el payload de creatuagente.
export function toZonedISO(dateISO: string, timeZone = 'Europe/Madrid'): string {
  const d = new Date(dateISO)
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value]))
  const offsetRaw =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(d)
      .find((x) => x.type === 'timeZoneName')?.value || 'GMT+00:00'
  const offset = offsetRaw.replace('GMT', '') || '+00:00'
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`
}

export function addMinutesISO(dateISO: string, minutes: number, timeZone = 'Europe/Madrid'): string {
  const d = new Date(new Date(dateISO).getTime() + minutes * 60000)
  return toZonedISO(d.toISOString(), timeZone)
}

async function postCreatuagente(body: string, logCtx: string): Promise<void> {
  const url = process.env.CREATUAGENTE_WEBHOOK_URL
  const secret = process.env.CREATUAGENTE_WEBHOOK_SECRET
  if (!url || !secret) return
  const ts = Math.floor(Date.now() / 1000)
  const firma = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-timestamp': String(ts),
        'x-webhook-signature': `sha256=${firma}`,
      },
      body,
    })
    const data = (await res.json().catch(() => null)) as { aplicada?: boolean; motivo?: string } | null
    if (!res.ok) {
      console.error(`[creatuagente] HTTP ${res.status} notificando ${logCtx}`)
    } else if (data && data.aplicada === false) {
      // 200 OK no significa que se haya procesado: si no reconocen al contacto responden
      // aplicada:false sin dar error HTTP (visto con "contacto_desconocido").
      console.error(`[creatuagente] No aplicada (${data.motivo}) notificando ${logCtx}`)
    }
  } catch (err) {
    console.error(`[creatuagente] Error de red notificando ${logCtx}:`, err)
  }
}

// No lanza: un fallo de creatuagente (caído, secreto rotado, red) no debe romper
// la creación/actualización de la cita en la app, que ya se aplicó antes de llamar aquí.
export async function notifyCreatuagente(
  evento: CreatuagenteEvento,
  token: string | null | undefined,
  // El receptor valida los eventos `cita.*` exigiendo esta clave EXACTA ("cita: Required"
  // si se llama de otra forma, comprobado en producción).
  cita: CreatuagenteCita
): Promise<void> {
  if (!token) return
  await postCreatuagente(JSON.stringify({ evento, token, cita }), `${evento} (token=${token})`)
}

// Envía venta.registrada. Ver el comentario de CreatuagenteVentaRegistrada: el sobre no
// lleva "token", el identificador de contacto va en idExterno (top-level).
export async function notifyCreatuagenteVenta(
  idExternoContacto: string | null | undefined,
  venta: CreatuagenteVentaRegistrada
): Promise<void> {
  if (!idExternoContacto) return
  await postCreatuagente(
    JSON.stringify({ evento: 'venta.registrada', idExterno: idExternoContacto, venta }),
    `venta.registrada (idExterno=${idExternoContacto}, venta.idExterno=${venta.idExterno})`
  )
}
