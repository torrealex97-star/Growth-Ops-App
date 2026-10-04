// REDIRECCIONES SOLO A RUTAS DE ESTA APP.
//
// `${origin}${next}` con `next` controlado por quien manda el enlace es una redirección abierta:
// `next=@sitio-malo.com` produce `https://app.dominio.com@sitio-malo.com` (el navegador lo lee como
// usuario@host y navega a sitio-malo.com), y `//sitio-malo.com` o `/\sitio-malo.com` también escapan.
// Solo se acepta una ruta relativa que empiece por UNA barra y no lleve barras invertidas, saltos de
// línea ni esquema; cualquier otra cosa cae a la ruta por defecto.

export function rutaInternaSegura(next: string | null | undefined, porDefecto: string): string {
  if (!next) return porDefecto
  if (!next.startsWith('/') || next.startsWith('//')) return porDefecto
  if (/[\\\r\n\t\0]/.test(next)) return porDefecto
  try {
    // Debe resolverse DENTRO del mismo origen que la base ficticia.
    const base = 'https://base.invalid'
    const url = new URL(next, base)
    if (url.origin !== base) return porDefecto
  } catch {
    return porDefecto
  }
  return next
}
