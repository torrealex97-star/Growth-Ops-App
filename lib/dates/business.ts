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
