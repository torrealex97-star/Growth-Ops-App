import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// ---- env ----
const envTxt = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
const env = {}
for (const line of envTxt.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SVC = env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_URL || !SVC) throw new Error('Faltan credenciales Supabase en .env.local')
const sb = createClient(SUPA_URL, SVC, { auth: { persistSession: false } })

const BUCKET = 'carrusel-uploads'
const PHOTO_DIR = '/tmp/adri_up'

// ---- brand ----
const C = {
  navy: '#071f3d',
  navy2: '#0b2c52',
  ink: '#0a1420',
  accent: '#1e9eff',
  accent2: '#3ea6ff',
}
const DISPLAY = "'Space Grotesk'"
const BODY = "'Inter'"

// ---- upload photos ----
async function ensureBucket() {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (!data) {
    await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '15MB' })
    console.log('· bucket creado:', BUCKET)
  }
}

async function uploadPhotos() {
  const urls = {}
  for (const file of fs.readdirSync(PHOTO_DIR)) {
    if (!file.endsWith('.jpg')) continue
    const key = `reference/adri/${file}`
    const buf = fs.readFileSync(path.join(PHOTO_DIR, file))
    const { error } = await sb.storage.from(BUCKET).upload(key, buf, { contentType: 'image/jpeg', upsert: true })
    if (error) throw new Error(`upload ${file}: ${error.message}`)
    const { data } = sb.storage.from(BUCKET).getPublicUrl(key)
    urls[file.replace('.jpg', '')] = data.publicUrl
    console.log('· foto:', file)
  }
  return urls
}

// ---- set brand row ----
async function setBrand() {
  const { error } = await sb.from('carrusel_brand').upsert({
    id: 1,
    name: 'Growth Ops',
    colors: {
      primary: C.navy2,
      secondary: C.navy,
      accent: C.accent,
      background: C.navy,
      surface: '#0e3563',
    },
    fonts: { heading: 'Space Grotesk', body: 'Inter' },
    style_keywords: ['azul eléctrico', 'cromo', 'glow', 'rejilla sutil', 'premium', 'Stripe/Mercury'],
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error('brand: ' + error.message)
  console.log('· marca Growth Ops aplicada')
}

// ---- HTML helpers (body fragment; wrapper sizes to 1080x1350) ----
const GRID_BG = `background:
  radial-gradient(circle at 50% -10%, rgba(30,158,255,.22), transparent 55%),
  radial-gradient(circle at 100% 110%, rgba(30,158,255,.12), transparent 45%),
  linear-gradient(rgba(30,158,255,.045) 1px, transparent 1px) 0 0/54px 54px,
  linear-gradient(90deg, rgba(30,158,255,.045) 1px, transparent 1px) 0 0/54px 54px,
  ${C.navy};`

const CHROME = `background:linear-gradient(180deg,#ffffff 0%,#dcecff 50%,#7fbaf0 100%);-webkit-background-clip:text;background-clip:text;color:transparent;`

const root = (inner, bg) =>
  `<div style="position:relative;width:1080px;height:1350px;overflow:hidden;font-family:${BODY},sans-serif;${bg}">${inner}</div>`

const handle = (color = 'rgba(255,255,255,.85)') =>
  `<div style="position:absolute;bottom:56px;left:64px;display:flex;align-items:center;gap:12px;font-family:${DISPLAY};font-weight:700;font-size:26px;letter-spacing:.02em;color:${color};z-index:5;">
    <span style="display:inline-flex;width:40px;height:40px;border-radius:11px;background:${C.accent};box-shadow:0 0 26px rgba(30,158,255,.75);align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:800;">IA</span>
    Growth Ops
  </div>`

const swipe = () =>
  `<div style="position:absolute;bottom:58px;right:64px;font-family:${DISPLAY};font-weight:600;font-size:24px;color:${C.accent2};letter-spacing:.04em;z-index:5;">desliza →</div>`

// COVER slide: full photo + gradient + kicker + big chrome title
function cover({ url, kicker, title, pos = 'center 25%' }) {
  const inner = `
    <img crossorigin="anonymous" src="${url}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${pos};" />
    <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(4,15,32,.55) 0%, rgba(4,15,32,.15) 32%, rgba(4,15,32,.72) 62%, rgba(4,15,32,.96) 100%);"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(90deg, rgba(30,158,255,.18) 0%, transparent 40%);"></div>
    <div style="position:absolute;top:60px;left:64px;display:flex;align-items:center;gap:12px;z-index:5;">
      <span style="display:inline-flex;width:44px;height:44px;border-radius:12px;background:${C.accent};box-shadow:0 0 30px rgba(30,158,255,.8);align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:800;font-family:${DISPLAY};">IA</span>
      <span style="font-family:${DISPLAY};font-weight:700;font-size:27px;color:#fff;letter-spacing:.02em;">Growth Ops</span>
    </div>
    <div style="position:absolute;left:64px;right:64px;bottom:150px;z-index:5;">
      <div style="display:inline-block;font-family:${DISPLAY};font-weight:700;font-size:24px;letter-spacing:.18em;text-transform:uppercase;color:${C.accent2};background:rgba(30,158,255,.14);border:1px solid rgba(30,158,255,.4);padding:10px 20px;border-radius:999px;margin-bottom:26px;">${kicker}</div>
      <div style="font-family:${DISPLAY};font-weight:800;font-size:88px;line-height:1.02;letter-spacing:-.02em;${CHROME}">${title}</div>
    </div>
    ${swipe()}`
  return root(inner, '')
}

// CONTENT slide: dark grid + accent index + heading + body
function content({ index, kicker, heading, body, big }) {
  const bigBlock = big
    ? `<div style="font-family:${DISPLAY};font-weight:800;font-size:150px;line-height:1;${CHROME}margin-bottom:24px;">${big}</div>`
    : ''
  const idxBlock = index
    ? `<div style="font-family:${DISPLAY};font-weight:800;font-size:40px;color:${C.accent};width:88px;height:88px;border-radius:20px;background:rgba(30,158,255,.12);border:1px solid rgba(30,158,255,.35);display:flex;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(30,158,255,.25);margin-bottom:40px;">${index}</div>`
    : ''
  const kickerBlock = kicker
    ? `<div style="font-family:${DISPLAY};font-weight:700;font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:${C.accent2};margin-bottom:26px;">${kicker}</div>`
    : ''
  const inner = `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 90px;">
      ${idxBlock}${kickerBlock}${bigBlock}
      <div style="font-family:${DISPLAY};font-weight:800;font-size:${heading.length > 34 ? 62 : 74}px;line-height:1.05;letter-spacing:-.02em;${CHROME}margin-bottom:${body ? 34 : 0}px;">${heading}</div>
      ${body ? `<div style="font-family:${BODY};font-weight:400;font-size:40px;line-height:1.4;color:rgba(226,240,255,.9);max-width:840px;">${body}</div>` : ''}
    </div>
    <div style="position:absolute;top:0;left:0;width:100%;height:8px;background:linear-gradient(90deg,${C.accent},transparent);"></div>
    ${handle()}`
  return root(inner, GRID_BG)
}

// CTA slide: photo side + dark + big CTA pill
function cta({ url, title, ctaText, note = 'Guarda este post', pos = 'center 20%' }) {
  const inner = `
    <img crossorigin="anonymous" src="${url}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${pos};" />
    <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(4,15,32,.45) 0%, rgba(4,15,32,.78) 55%, rgba(7,31,61,.97) 100%);"></div>
    <div style="position:absolute;inset:0;${GRID_BG.replace('background:', 'background:').replace(`${C.navy};`, 'transparent;')}opacity:.5;"></div>
    <div style="position:absolute;left:64px;right:64px;bottom:150px;z-index:5;">
      <div style="font-family:${DISPLAY};font-weight:800;font-size:74px;line-height:1.04;letter-spacing:-.02em;${CHROME}margin-bottom:38px;">${title}</div>
      <div style="display:inline-flex;align-items:center;gap:16px;background:${C.accent};color:#fff;font-family:${DISPLAY};font-weight:800;font-size:46px;padding:26px 44px;border-radius:999px;box-shadow:0 0 50px rgba(30,158,255,.75);">${ctaText}</div>
      <div style="margin-top:30px;font-family:${BODY};font-weight:500;font-size:32px;color:rgba(226,240,255,.85);">💾 ${note}</div>
    </div>
    <div style="position:absolute;top:60px;left:64px;display:flex;align-items:center;gap:12px;z-index:5;">
      <span style="display:inline-flex;width:44px;height:44px;border-radius:12px;background:${C.accent};box-shadow:0 0 30px rgba(30,158,255,.8);align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:800;font-family:${DISPLAY};">IA</span>
      <span style="font-family:${DISPLAY};font-weight:700;font-size:27px;color:#fff;">Growth Ops</span>
    </div>`
  return root(inner, C.navy)
}

// ---- build slide objects ----
const slide = (html) => ({ id: randomUUID(), html, notes: '', previousVersions: [] })

function buildCarousels(P) {
  return [
    {
      title: '1 · Agentes IA — Setting AI',
      caption:
        'Mientras lees esto hay leads escribiéndote que nunca vas a contestar a tiempo. 🕒\nSetting AI responde tus DMs como si fueras tú, cualifica y te agenda las llamadas mientras trabajas (o duermes).\n¿Lo quieres en tu cuenta? Comenta «AGENTE» 💪',
      hashtags: ['InteligenciaArtificial', 'AgenciaDeIA', 'Automatización', 'GrowthOps', 'IAparaNegocios'],
      slides: [
        cover({
          url: P['adri-laptop-down'],
          kicker: 'Agentes IA',
          title: 'Tu mejor comercial no duerme. Ni cobra.',
          pos: 'center 22%',
        }),
        content({
          kicker: 'El problema',
          heading: 'Cientos de DMs sin contestar',
          body: 'Los leads se enfrían en 20 minutos y tú no llegas a todos. Cada mensaje frío es una llamada perdida.',
        }),
        content({
          kicker: 'La solución',
          heading: 'Setting AI',
          body: 'Responde tus DMs de Instagram como si fueras tú. En tu tono. Las 24 horas. Nunca suena a bot.',
        }),
        content({
          kicker: 'Qué hace',
          heading: 'Cualifica y agenda solo',
          body: 'Detecta si el lead tiene tiempo y dinero, y te deja la llamada agendada en el calendario.',
        }),
        cta({
          url: P['adri-laptop-front'],
          title: '¿Lo quieres en tu cuenta?',
          ctaText: 'Escribe «AGENTE»',
          pos: 'center 18%',
        }),
      ],
    },
    {
      title: '2 · Herramientas nuevas de IA',
      caption:
        'El secreto no es "usar ChatGPT". Es tener un sistema donde cada herramienta te quita horas. ⚙️\nEstas 5 son las que usamos en Growth Ops a diario.\n¿Quieres montar las tuyas? Comenta «IA» 👇',
      hashtags: ['HerramientasIA', 'ProductividadIA', 'AgenciaDeIA', 'GrowthOps', 'AutomatizaTuNegocio'],
      slides: [
        cover({
          url: P['adri-laptop-side'],
          kicker: 'Herramientas',
          title: '5 herramientas de IA que hacen el trabajo de un equipo',
          pos: 'center 20%',
        }),
        content({
          index: '1',
          heading: 'Carruseles con IA',
          body: 'Le das un tema y te diseña el carrusel con tu marca aplicada. Sí, como este.',
        }),
        content({
          index: '2',
          heading: 'Reels del día',
          body: 'Mina reels virales de tu nicho y te devuelve el guión adaptado, con hook y CTA.',
        }),
        content({
          index: '3',
          heading: 'Facturas + Llamadas',
          body: 'Foto → datos extraídos. Y transcribe tus ventas puntuándolas /10 para cerrar mejor.',
        }),
        content({ index: '4', heading: 'Setting AI', body: 'Responde tus DMs y te agenda las llamadas solo, 24/7.' }),
        cta({
          url: P['adri-laptop-front'],
          title: 'Monta tu propia suite de IA',
          ctaText: 'Comenta «IA»',
          pos: 'center 18%',
        }),
      ],
    },
    {
      title: '3 · Estrategias — Método DMD',
      caption:
        'Vender por DM soltando el precio es la forma más rápida de quemar un lead. 🔥\nEl método DMD (Dolor → Miedo → Deseo) convierte una conversación fría en una llamada agendada.\n¿Quieres el guion? Escribe «DMD» 👇',
      hashtags: ['VentasOnline', 'Closer', 'Setting', 'GrowthOps', 'EstrategiaDeVentas'],
      slides: [
        cover({
          url: P['adri-teach-2'],
          kicker: 'Estrategia',
          title: 'Deja de vender por DM. Empieza a cualificar.',
          pos: 'center 15%',
        }),
        content({
          kicker: 'El error',
          heading: 'Soltar el precio ya',
          body: 'Dar el precio en el primer mensaje solo espanta leads. Primero se genera contexto.',
        }),
        content({
          kicker: 'El marco',
          heading: 'D · M · D',
          body: 'Dolor → Miedo → Deseo. Ese es el orden. Con 1 dolor + 1 deseo + 1 freno claros, ya puedes ofrecer la llamada.',
        }),
        content({
          kicker: 'La táctica',
          heading: 'Valida antes de opinar',
          body: 'Reconoce → Valida → Pregunta. La gente compra a quien la entiende, no a quien la interroga.',
        }),
        content({
          kicker: 'La regla',
          heading: 'Máx. 1 pregunta cada 3 mensajes',
          body: 'Un DM no es un interrogatorio. Nunca dos «?» seguidos.',
        }),
        cta({
          url: P['adri-teach-1'],
          title: '¿Quieres el guion completo?',
          ctaText: 'Comenta «DMD»',
          pos: 'center 12%',
        }),
      ],
    },
    {
      title: '4 · Servicios — Agencia de IA',
      caption:
        'No necesitas otro producto que "revender". Necesitas un vehículo que no dependa de suerte ni de stock. 🚀\nUna Agencia de IA se monta desde casa vendiendo soluciones que los negocios YA buscan.\n¿Te enseño cómo? Comenta «AGENCIA» 👇',
      hashtags: ['AgenciaDeIA', 'NegociosOnline', 'LibertadFinanciera', 'GrowthOps', 'EmprenderConIA'],
      slides: [
        cover({
          url: P['adri-class'],
          kicker: 'Servicios',
          title: 'El negocio con menos barreras de 2026',
          pos: 'center 20%',
        }),
        content({
          kicker: 'Reencuadre',
          heading: 'No era tu culpa',
          body: 'Probaste dropshipping, trading, FBA… y nada funcionó. No eras tú: era el vehículo.',
        }),
        content({
          kicker: 'La oportunidad',
          heading: 'Los negocios quieren IA',
          body: 'Pero no saben ni por dónde empezar. Ahí entras tú: les montas la solución y cobras por ello.',
        }),
        content({
          kicker: 'La ventaja',
          heading: 'Sin stock. Sin equipo.',
          body: 'Sin oficina. Solo tú, un ordenador y un sistema que funciona.',
        }),
        content({ heading: 'Haces el trabajo de dueño de agencia… cobrando el sueldo de otro.' }),
        cta({
          url: P['adri-teach-1'],
          title: 'Te enseño el modelo en una llamada',
          ctaText: 'Comenta «AGENCIA»',
          pos: 'center 12%',
        }),
      ],
    },
    {
      title: '5 · Historia + Master IA Expert',
      caption:
        'De La Mina a Andorra. De arruinado a una comunidad de cientos de alumnos. 🙏🏼\nNo fue suerte: fue elegir el vehículo correcto (agencia de IA) y seguir un método.\nEse sistema es Master IA Expert. Comenta «WINNER» 👇',
      hashtags: ['HistoriaReal', 'AgenciaDeIA', 'Mentalidad', 'GrowthOps', 'Emprender'],
      slides: [
        cover({
          url: P['adri-laptop-front'],
          kicker: 'Mi historia',
          title: 'Me quedaban 1.600€. Y una deuda enorme.',
          pos: 'center 16%',
        }),
        content({
          heading: 'Toqué fondo',
          body: '9 años y medio de discotecas. Monté la mía. Me arruiné. Ansiedad, depresión, deuda.',
        }),
        content({
          heading: 'El giro',
          body: 'Con lo último que me quedaba me compré un ordenador y monté una agencia desde el salón de mi casa.',
        }),
        content({ big: '1.500€', heading: 'Primer cliente en menos de 7 días' }),
        content({
          heading: 'Hoy',
          body: 'Vivo en Andorra, trabajo desde Bali y tengo una comunidad de cientos de Winners.',
        }),
        cta({
          url: P['adri-class'],
          title: 'El sistema es Master IA Expert',
          ctaText: 'Comenta «WINNER»',
          pos: 'center 18%',
        }),
      ],
    },
    // ---- 3 VIRALES ----
    {
      title: 'VIRAL 1 · La IA trabaja por ti',
      caption:
        'Esto ya no es el futuro. Es lo que la IA hace HOY mientras tú duermes. 😴🤖\nGuárdatelo y empieza por uno.\nSígueme para más 👉',
      hashtags: ['InteligenciaArtificial', 'IAparaNegocios', 'Automatización', 'GrowthOps', 'FuturoDelTrabajo'],
      slides: [
        cover({
          url: P['adri-laptop-down'],
          kicker: 'Viral',
          title: '5 cosas que la IA hace por ti mientras duermes',
          pos: 'center 22%',
        }),
        content({
          index: '1',
          heading: 'Responde tus DMs',
          body: 'Y te agenda clientes en el calendario sin que muevas un dedo.',
        }),
        content({
          index: '2',
          heading: 'Te escribe los reels',
          body: 'Analiza lo que se está haciendo viral en tu nicho y te da el guión.',
        }),
        content({
          index: '3',
          heading: 'Lleva tu contabilidad',
          body: 'Le haces una foto a la factura y la registra por ti.',
        }),
        content({
          index: '4',
          heading: 'Diseña tus carruseles',
          body: 'Con tu marca. Como el que estás viendo ahora mismo.',
        }),
        cta({
          url: P['adri-laptop-front'],
          title: 'Y esto es solo el principio',
          ctaText: 'Sígueme para más',
          note: 'Guarda esto para no perderlo',
          pos: 'center 18%',
        }),
      ],
    },
    {
      title: 'VIRAL 2 · La IA y tu trabajo',
      caption:
        'No es miedo, es matemática. 📊\nEn cada cambio de era gana quien se adapta primero.\n¿Por dónde empezar? Comenta «IA» y te lo digo 👇',
      hashtags: ['InteligenciaArtificial', 'Mentalidad', 'FuturoDelTrabajo', 'GrowthOps', 'Reinvéntate'],
      slides: [
        cover({
          url: P['adri-teach-1'],
          kicker: 'Viral',
          title: 'La IA no te va a quitar el trabajo.',
          pos: 'center 12%',
        }),
        content({ heading: 'Te lo va a quitar quien sepa usarla.' }),
        content({
          kicker: 'Piénsalo',
          heading: 'Ya ha pasado antes',
          body: 'En 2005 no saber usar internet te dejaba fuera. En 2026 es la IA. La historia se repite.',
        }),
        content({
          kicker: 'La buena noticia',
          heading: 'Aún estás a tiempo',
          body: 'De estar en el lado correcto de la línea. Pero la ventana se cierra rápido.',
        }),
        cta({
          url: P['adri-laptop-front'],
          title: 'Empieza hoy, no mañana',
          ctaText: 'Comenta «IA»',
          pos: 'center 18%',
        }),
      ],
    },
    {
      title: 'VIRAL 3 · Cobré 1.500€ en una tarde',
      caption:
        'La gente cree que montar un negocio con IA es complicadísimo. No lo es. 🤝\nEsto es literalmente lo que hace una Agencia de IA.\n¿Quieres el paso a paso? Comenta «AGENCIA» 👇',
      hashtags: ['AgenciaDeIA', 'CasoReal', 'NegociosOnline', 'GrowthOps', 'IAparaNegocios'],
      slides: [
        cover({
          url: P['adri-laptop-side'],
          kicker: 'Caso real',
          title: 'Cobré 1.500€ por algo que monté en una tarde',
          pos: 'center 20%',
        }),
        content({
          kicker: 'El problema',
          heading: 'El negocio perdía clientes',
          body: 'Le escribían por Instagram y nadie respondía a tiempo. Leads a la basura cada día.',
        }),
        content({
          kicker: 'La solución',
          heading: 'Un agente de IA',
          body: 'Le monté un sistema que responde y agenda solo, 24/7, con su tono de marca.',
        }),
        content({
          kicker: 'El resultado',
          heading: 'Él ahorra horas. Yo cobré.',
          body: 'Por un sistema que sigue funcionando aunque yo esté durmiendo.',
        }),
        cta({
          url: P['adri-class'],
          title: 'Esto es una Agencia de IA',
          ctaText: 'Comenta «AGENCIA»',
          pos: 'center 18%',
        }),
      ],
    },
  ]
}

async function main() {
  await ensureBucket()
  const photos = await uploadPhotos()
  await setBrand()

  const carousels = buildCarousels(photos)

  // Limpia versiones previas de estos mismos carruseles (re-ejecutable)
  const titles = carousels.map((c) => c.title)
  const { error: delErr } = await sb.from('carrusel_projects').delete().in('title', titles)
  if (delErr) throw new Error('cleanup: ' + delErr.message)

  for (const c of carousels) {
    const { data, error } = await sb
      .from('carrusel_projects')
      .insert({
        title: c.title,
        kind: 'carousel',
        aspect_ratio: '4:5',
        slides: c.slides.map((h) => (typeof h === 'string' ? slide(h) : h)),
        caption: c.caption,
        hashtags: c.hashtags,
        is_template: false,
      })
      .select('id')
      .single()
    if (error) throw new Error(`insert "${c.title}": ${error.message}`)
    console.log(`✓ ${c.title}  (${c.slides.length} slides)  →  /evergreen/carruseles/${data.id}`)
  }
  console.log('\nListo:', carousels.length, 'carruseles creados.')
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
