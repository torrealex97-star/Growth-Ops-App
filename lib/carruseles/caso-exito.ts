// Plantillas de marca para carruseles de CASOS DE ÉXITO.
//
// El HTML se genera de forma determinista (no lo escribe el modelo), así que todos los
// casos de éxito salen con el mismo estilo: navy + azul eléctrico, rejilla sutil,
// titulares en Space Grotesk con degradado cromado y cuerpo en Inter.
//
// El modelo solo se encarga de extraer el CONTENIDO (hook, punto A, punto B, cifra,
// vehículo) del texto libre que pega el usuario. Ver:
//   app/api/${tenant}/evergreen/carruseles/caso-exito/route.ts
//
// NOTA: esta es la copia canónica de estos títulos (el script generador se retiró del repo)
// plantillas porque es un script standalone de Node y no puede importar TypeScript.
// Si cambias el estilo aquí, cámbialo también allí.

/** CTA fijo de la marca: todos los carruseles cierran llevando al recurso principal.
 * Editable — ajusta estos textos a tu propia oferta. */
export const CTA_TITLE = 'Descubre más en el enlace'
export const CTA_PILL = '🔗 Enlace en la bio'
export const CTA_CAPTION_LINE = 'Tienes más info en el enlace de la bio 🔗'

const C = {
  navy: '#071f3d',
  accent: '#1e9eff',
  accent2: '#3ea6ff',
}
const DISPLAY = "'Space Grotesk'"
const BODY = "'Inter'"

const GRID_BG = `background:
  radial-gradient(circle at 50% -10%, rgba(30,158,255,.22), transparent 55%),
  radial-gradient(circle at 100% 110%, rgba(30,158,255,.12), transparent 45%),
  linear-gradient(rgba(30,158,255,.045) 1px, transparent 1px) 0 0/54px 54px,
  linear-gradient(90deg, rgba(30,158,255,.045) 1px, transparent 1px) 0 0/54px 54px,
  ${C.navy};`

const CHROME =
  'background:linear-gradient(180deg,#ffffff 0%,#dcecff 50%,#7fbaf0 100%);-webkit-background-clip:text;background-clip:text;color:transparent;'

const root = (inner: string) =>
  `<div style="position:relative;width:1080px;height:1350px;overflow:hidden;font-family:${BODY},sans-serif;${GRID_BG}">${inner}</div>`

const brandRow = () =>
  `<div style="position:absolute;top:60px;left:64px;display:flex;align-items:center;gap:12px;z-index:5;">
    <span style="display:inline-flex;width:44px;height:44px;border-radius:12px;background:${C.accent};box-shadow:0 0 30px rgba(30,158,255,.8);align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:800;font-family:${DISPLAY};">S</span>
  </div>`

const handle = () =>
  `<div style="position:absolute;bottom:56px;left:64px;display:flex;align-items:center;gap:12px;font-family:${DISPLAY};font-weight:700;font-size:26px;letter-spacing:.02em;color:rgba(255,255,255,.85);z-index:5;">
    <span style="display:inline-flex;width:40px;height:40px;border-radius:11px;background:${C.accent};box-shadow:0 0 26px rgba(30,158,255,.75);align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:800;">S</span>
  </div>`

const swipe = () =>
  `<div style="position:absolute;bottom:58px;right:64px;font-family:${DISPLAY};font-weight:600;font-size:24px;color:${C.accent2};letter-spacing:.04em;z-index:5;">desliza →</div>`

/** Escapa el texto del usuario/modelo antes de meterlo en el HTML de la slide. */
function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Portada: foto real en tarjeta (respeta su proporción) + chip + hook. */
function coverSlide(opts: { photoUrl: string; name: string; label?: string; hook: string }): string {
  const hook = esc(opts.hook)
  const size = hook.length > 62 ? 66 : hook.length > 44 ? 74 : 84
  return root(`
    ${brandRow()}
    <div style="position:absolute;top:150px;left:64px;right:64px;bottom:130px;display:flex;flex-direction:column;justify-content:center;gap:44px;z-index:4;">
      <div>
        <div style="display:inline-block;font-family:${DISPLAY};font-weight:700;font-size:23px;letter-spacing:.18em;text-transform:uppercase;color:${C.accent2};background:rgba(30,158,255,.14);border:1px solid rgba(30,158,255,.4);padding:10px 20px;border-radius:999px;margin-bottom:26px;">${esc(opts.label || 'Caso de éxito')} · ${esc(opts.name)}</div>
        <div style="font-family:${DISPLAY};font-weight:800;font-size:${size}px;line-height:1.04;letter-spacing:-.02em;${CHROME}">${hook}</div>
      </div>
      <div style="position:relative;border-radius:28px;overflow:hidden;border:2px solid rgba(30,158,255,.55);box-shadow:0 0 70px rgba(30,158,255,.35), 0 24px 60px rgba(0,0,0,.45);">
        <img crossorigin="anonymous" src="${esc(opts.photoUrl)}" style="display:block;width:100%;height:auto;" />
      </div>
    </div>
    ${swipe()}`)
}

/** Slide de contenido: kicker + (cifra grande) + titular + cuerpo. */
function contentSlide(opts: { kicker?: string; heading: string; body?: string; big?: string }): string {
  const heading = esc(opts.heading)
  const big = opts.big ? esc(opts.big) : ''
  const bigBlock = big
    ? `<div style="font-family:${DISPLAY};font-weight:800;font-size:${big.length > 9 ? 112 : 150}px;line-height:1;${CHROME}margin-bottom:24px;">${big}</div>`
    : ''
  const kickerBlock = opts.kicker
    ? `<div style="font-family:${DISPLAY};font-weight:700;font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:${C.accent2};margin-bottom:26px;">${esc(opts.kicker)}</div>`
    : ''
  const hSize = heading.length > 52 ? 56 : heading.length > 34 ? 62 : 74
  return root(`
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 90px;">
      ${kickerBlock}${bigBlock}
      <div style="font-family:${DISPLAY};font-weight:800;font-size:${hSize}px;line-height:1.05;letter-spacing:-.02em;${CHROME}margin-bottom:${opts.body ? 34 : 0}px;">${heading}</div>
      ${opts.body ? `<div style="font-family:${BODY};font-weight:400;font-size:38px;line-height:1.42;color:rgba(226,240,255,.9);max-width:860px;">${esc(opts.body)}</div>` : ''}
    </div>
    <div style="position:absolute;top:0;left:0;width:100%;height:8px;background:linear-gradient(90deg,${C.accent},transparent);"></div>
    ${handle()}`)
}

/** CTA de cierre: frase gancho + clase gratuita + enlace en la bio. */
function ctaSlide(opts: { lead?: string }): string {
  const leadBlock = opts.lead
    ? `<div style="font-family:${DISPLAY};font-weight:700;font-size:34px;line-height:1.25;color:${C.accent2};margin-bottom:28px;">${esc(opts.lead)}</div>`
    : ''
  return root(`
    ${brandRow()}
    <div style="position:absolute;left:64px;right:64px;top:50%;transform:translateY(-50%);z-index:5;">
      ${leadBlock}
      <div style="font-family:${DISPLAY};font-weight:800;font-size:74px;line-height:1.04;letter-spacing:-.02em;${CHROME}margin-bottom:44px;">${CTA_TITLE}</div>
      <div style="display:inline-flex;align-items:center;gap:16px;background:${C.accent};color:#fff;font-family:${DISPLAY};font-weight:800;font-size:44px;padding:26px 44px;border-radius:999px;box-shadow:0 0 50px rgba(30,158,255,.75);">${CTA_PILL}</div>
      <div style="margin-top:34px;font-family:${BODY};font-weight:500;font-size:32px;color:rgba(226,240,255,.85);">💾 Guarda este post</div>
    </div>
    <div style="position:absolute;bottom:0;left:0;width:100%;height:10px;background:linear-gradient(90deg,transparent,${C.accent});"></div>`)
}

// ---------------------------------------------------------------------------

interface CasoExitoContentSlide {
  kicker?: string
  heading: string
  body?: string
  big?: string
}

export interface CasoExitoSpec {
  /** Título del proyecto en el dashboard. Se le fuerza el prefijo CASO. */
  title: string
  /** Nombre que sale en el chip de la portada. */
  name: string
  /** "Caso de éxito" (alumno) o "Caso cliente" (cliente de implementación). */
  label?: string
  hook: string
  slides: CasoExitoContentSlide[]
  ctaLead?: string
  caption?: string
  hashtags?: string[]
}

/** Prefijo con el que el dashboard agrupa los carruseles de casos de éxito. */
export const CASO_TITLE_PREFIX = 'CASO'

export function normalizeCasoTitle(title: string, name: string): string {
  const t = title.trim() || `Caso de éxito de ${name.trim()}`
  return t.toUpperCase().startsWith(CASO_TITLE_PREFIX) ? t : `CASO · ${t}`
}

export const MAX_CONTENT_SLIDES = 8

/** Construye el HTML de todas las slides: portada → contenido → CTA. */
export function buildCasoExitoSlides(spec: CasoExitoSpec, photoUrl: string): string[] {
  const body = spec.slides.slice(0, MAX_CONTENT_SLIDES).map((s) => contentSlide(s))
  return [
    coverSlide({ photoUrl, name: spec.name, label: spec.label, hook: spec.hook }),
    ...body,
    ctaSlide({ lead: spec.ctaLead }),
  ]
}

/** Añade la línea del CTA de la bio al caption si no la lleva ya. */
export function buildCaption(caption?: string): string {
  const base = (caption || '').trim()
  if (base.toLowerCase().includes('enlace de la bio')) return base
  return base ? `${base}\n\n${CTA_CAPTION_LINE}` : CTA_CAPTION_LINE
}
