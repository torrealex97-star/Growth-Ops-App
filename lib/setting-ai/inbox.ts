// Helpers PUROS de la bandeja de conversaciones (Setting AI › Conversaciones).
// Sin React ni fetch: los tests los importan directamente (node no carga .tsx) y el componente
// se limita a pintarlos. Todo lo que depende del reloj acepta `ahora` inyectable para ser
// determinista en tests.

export type MsgMin = { from: 'agente' | 'lead'; text?: string; created_time?: string }

/**
 * Iniciales para el avatar (máx. 2 letras). Devuelve null cuando no hay nombre real del que
 * derivarlas: teléfonos (empiezan por + o son casi todo dígitos) y cadenas vacías — en ese caso
 * la UI pinta el icono del canal en lugar de inventar letras.
 */
export function inicialesDe(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? '').trim()
  if (!limpio) return null
  if (/^\+?\d[\d\s.-]{5,}$/.test(limpio)) return null
  const base = limpio.includes('@') ? limpio.split('@')[0] : limpio
  const iniciales = base
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((p) => (/\d/.test(p) ? null : p[0]?.toUpperCase()))
    .filter((v): v is string => !!v)
  if (!iniciales.length) return null
  return (iniciales[0] + (iniciales[1] ?? '')).slice(0, 2)
}

/** "ahora" / "hace X min" / "hace X h" / "hace X d" / fecha corta. null si no hay fecha válida. */
export function tiempoRelativo(iso: string | undefined, ahora: number = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const dif = ahora - t
  if (dif <= 0) return 'ahora'
  const min = Math.floor(dif / 60_000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `hace ${d} d`
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(t)
}

/** "09:41" en hora local. null si no hay fecha válida. */
export function horaDe(iso: string | undefined): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(t)
}

const inicioDeDia = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Clave estable de día local (para agrupar mensajes con separadores). '' si no hay fecha. */
export function claveDia(iso: string | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return String(inicioDeDia(t))
}

/** Separador de día: "Hoy" / "Ayer" / fecha corta (con año si no es el actual). */
export function etiquetaDia(iso: string | undefined, ahora: number = Date.now()): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const dias = Math.round((inicioDeDia(ahora) - inicioDeDia(t)) / 86_400_000)
  if (dias === 0) return 'Hoy'
  if (dias === 1) return 'Ayer'
  const mismoAnio = new Date(t).getFullYear() === new Date(ahora).getFullYear()
  return new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'short',
    ...(mismoAnio ? {} : { year: 'numeric' }),
  }).format(t)
}

/** Último mensaje (los listados llegan en orden cronológico ascendente). null si vacío. */
export function ultimoMensaje(msgs: MsgMin[]): MsgMin | null {
  return msgs.length ? (msgs[msgs.length - 1] as MsgMin) : null
}

/** Vista previa de la fila: los propios llevan el prefijo "Tú:" (convención de bandejas). */
export function vistaPrevia(m: MsgMin | null): string {
  if (!m) return 'Sin mensajes todavía'
  const texto = (m.text ?? '').trim()
  if (!texto) return '—'
  return m.from === 'agente' ? `Tú: ${texto}` : texto
}
