// El "hoy" y el "mes en curso" DEL NEGOCIO, no los de UTC.
//
// POR QUÉ EXISTE. El servidor corre en UTC (Vercel) y el navegador del equipo en hora de España.
// `new Date().toISOString().slice(0, 10)` da la fecha UTC, así que entre las 23:00 (invierno) o las
// 22:00 (verano) y medianoche, el servidor sigue en el día anterior mientras la pantalla ya está en
// el siguiente. Eso hacía que:
//   · el tramo del rep (y con él su % de comisión) se midiera con el mes equivocado dos horas al mes
//     — en Nochevieja, con el año equivocado;
//   · una cuota venciera o un borrador de reel contara en el día que no toca según la hora.
//
// Es la zona del NEGOCIO, no la del contacto: para mandar horas a un lead en LatAm está
// `lib/timezone.ts`, que la adivina por su teléfono. Aquí se trata de "qué día/mes es para la
// empresa", que es siempre España.
const BUSINESS_TIMEZONE = 'Europe/Madrid'

// en-CA formatea como YYYY-MM-DD, así que la fecha ya convertida a la zona sale lista para comparar
// con una columna DATE de Postgres y para cortarla por caracteres.
function formatInBusinessZone(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Fecha de hoy (YYYY-MM-DD) en la zona del negocio. */
export function businessToday(now = new Date()): string {
  return formatInBusinessZone(now)
}

/** Mes en curso (YYYY-MM) en la zona del negocio. */
export function businessYm(now = new Date()): string {
  return formatInBusinessZone(now).slice(0, 7)
}

/** Fecha (YYYY-MM-DD) → partes numéricas, o `null` si no es un día real del calendario. */
export function parseYmd(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  const check = new Date(Date.UTC(y, m - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null
  return { y, m, d }
}

/** Suma `dias` a una fecha YYYY-MM-DD en el calendario (sin horas: no hay saltos de DST que valgan). */
export function addDaysYmd(value: string, dias: number): string {
  const p = parseYmd(value)
  if (!p) return value
  return new Date(Date.UTC(p.y, p.m - 1, p.d + dias)).toISOString().slice(0, 10)
}

// Desfase (ms) de la zona del negocio respecto a UTC en un instante dado.
function businessOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** El instante en que EMPIEZA ese día (00:00) en la zona del negocio. */
export function businessStartOfDay(value: string): Date | null {
  const p = parseYmd(value)
  if (!p) return null
  const guess = Date.UTC(p.y, p.m - 1, p.d)
  let instant = guess - businessOffsetMs(new Date(guess))
  // Segunda pasada: el desfase puede cambiar entre la estimación y el instante real (cambio de hora).
  instant = guess - businessOffsetMs(new Date(instant))
  return new Date(instant)
}

/** El último milisegundo de ese día en la zona del negocio (el día siguiente empieza 1 ms después). */
export function businessEndOfDay(value: string): Date | null {
  const next = businessStartOfDay(addDaysYmd(value, 1))
  return next ? new Date(next.getTime() - 1) : null
}
