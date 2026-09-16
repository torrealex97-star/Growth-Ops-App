import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const envTxt = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8')
const env = {}
for (const line of envTxt.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const BUCKET = 'carrusel-uploads'
const PHOTO_DIR = '/tmp/vsl_up'

const C = { navy: '#071f3d', navy2: '#0b2c52', accent: '#1e9eff', accent2: '#3ea6ff' }
const DISPLAY = "'Space Grotesk'"
const BODY = "'Inter'"

async function uploadPhotos() {
  const urls = {}
  for (const file of fs.readdirSync(PHOTO_DIR)) {
    if (!file.endsWith('.jpg')) continue
    const key = `reference/vsl/${file}`
    const buf = fs.readFileSync(path.join(PHOTO_DIR, file))
    const { error } = await sb.storage.from(BUCKET).upload(key, buf, { contentType: 'image/jpeg', upsert: true })
    if (error) throw new Error(`upload ${file}: ${error.message}`)
    urls[file.replace('.jpg', '')] = sb.storage.from(BUCKET).getPublicUrl(key).data.publicUrl
    console.log('· foto:', file)
  }
  return urls
}

const GRID_BG = `background:
  radial-gradient(circle at 50% -10%, rgba(30,158,255,.22), transparent 55%),
  radial-gradient(circle at 100% 110%, rgba(30,158,255,.12), transparent 45%),
  linear-gradient(rgba(30,158,255,.045) 1px, transparent 1px) 0 0/54px 54px,
  linear-gradient(90deg, rgba(30,158,255,.045) 1px, transparent 1px) 0 0/54px 54px,
  ${C.navy};`
const CHROME = `background:linear-gradient(180deg,#ffffff 0%,#dcecff 50%,#7fbaf0 100%);-webkit-background-clip:text;background-clip:text;color:transparent;`

const root = (inner, bg) =>
  `<div style="position:relative;width:1080px;height:1350px;overflow:hidden;font-family:${BODY},sans-serif;${bg}">${inner}</div>`

const logoTop = () =>
  `<div style="position:absolute;top:60px;left:64px;display:flex;align-items:center;gap:12px;z-index:5;">
    <span style="display:inline-flex;width:44px;height:44px;border-radius:12px;background:${C.accent};box-shadow:0 0 30px rgba(30,158,255,.8);align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:800;font-family:${DISPLAY};">IA</span>
    <span style="font-family:${DISPLAY};font-weight:700;font-size:27px;color:#fff;letter-spacing:.02em;">Growth Ops</span>
  </div>`
const handle = () =>
  `<div style="position:absolute;bottom:56px;left:64px;display:flex;align-items:center;gap:12px;font-family:${DISPLAY};font-weight:700;font-size:26px;color:rgba(255,255,255,.85);z-index:5;">
    <span style="display:inline-flex;width:40px;height:40px;border-radius:11px;background:${C.accent};box-shadow:0 0 26px rgba(30,158,255,.75);align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:800;">IA</span>Growth Ops</div>`
const swipe = () =>
  `<div style="position:absolute;bottom:58px;right:64px;font-family:${DISPLAY};font-weight:600;font-size:24px;color:${C.accent2};z-index:5;">desliza →</div>`

function cover({ url, kicker, title, pos = 'center 25%' }) {
  return root(
    `
    <img crossorigin="anonymous" src="${url}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${pos};" />
    <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(4,15,32,.55) 0%, rgba(4,15,32,.12) 30%, rgba(4,15,32,.72) 60%, rgba(4,15,32,.97) 100%);"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(90deg, rgba(30,158,255,.18) 0%, transparent 42%);"></div>
    ${logoTop()}
    <div style="position:absolute;left:64px;right:64px;bottom:150px;z-index:5;">
      <div style="display:inline-block;font-family:${DISPLAY};font-weight:700;font-size:24px;letter-spacing:.16em;text-transform:uppercase;color:${C.accent2};background:rgba(30,158,255,.14);border:1px solid rgba(30,158,255,.4);padding:10px 20px;border-radius:999px;margin-bottom:26px;">${kicker}</div>
      <div style="font-family:${DISPLAY};font-weight:800;font-size:${title.length > 40 ? 74 : 88}px;line-height:1.02;letter-spacing:-.02em;${CHROME}">${title}</div>
    </div>
    ${swipe()}`,
    ''
  )
}

function content({ index, kicker, heading, body, big }) {
  const bigBlock = big
    ? `<div style="font-family:${DISPLAY};font-weight:800;font-size:140px;line-height:1;${CHROME}margin-bottom:24px;">${big}</div>`
    : ''
  const idxBlock = index
    ? `<div style="font-family:${DISPLAY};font-weight:800;font-size:40px;color:${C.accent};width:88px;height:88px;border-radius:20px;background:rgba(30,158,255,.12);border:1px solid rgba(30,158,255,.35);display:flex;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(30,158,255,.25);margin-bottom:40px;">${index}</div>`
    : ''
  const kickerBlock = kicker
    ? `<div style="font-family:${DISPLAY};font-weight:700;font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:${C.accent2};margin-bottom:26px;">${kicker}</div>`
    : ''
  return root(
    `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 90px;">
      ${idxBlock}${kickerBlock}${bigBlock}
      <div style="font-family:${DISPLAY};font-weight:800;font-size:${heading.length > 34 ? 60 : 72}px;line-height:1.05;letter-spacing:-.02em;${CHROME}margin-bottom:${body ? 34 : 0}px;">${heading}</div>
      ${body ? `<div style="font-family:${BODY};font-weight:400;font-size:38px;line-height:1.42;color:rgba(226,240,255,.9);max-width:850px;">${body}</div>` : ''}
    </div>
    <div style="position:absolute;top:0;left:0;width:100%;height:8px;background:linear-gradient(90deg,${C.accent},transparent);"></div>
    ${handle()}`,
    GRID_BG
  )
}

// Lista con checks (para "qué hace una Agencia de IA" y las 4 claves)
function list({ kicker, heading, items }) {
  const rows = items
    .map(
      (it) =>
        `<div style="display:flex;align-items:flex-start;gap:20px;margin-bottom:26px;">
      <span style="flex:none;margin-top:4px;width:44px;height:44px;border-radius:12px;background:rgba(30,158,255,.14);border:1px solid rgba(30,158,255,.4);display:flex;align-items:center;justify-content:center;color:${C.accent};font-size:26px;font-weight:800;font-family:${DISPLAY};">✓</span>
      <span style="font-family:${BODY};font-weight:500;font-size:36px;line-height:1.3;color:rgba(232,244,255,.95);">${it}</span>
    </div>`
    )
    .join('')
  return root(
    `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 84px;">
      ${kicker ? `<div style="font-family:${DISPLAY};font-weight:700;font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:${C.accent2};margin-bottom:22px;">${kicker}</div>` : ''}
      <div style="font-family:${DISPLAY};font-weight:800;font-size:60px;line-height:1.05;letter-spacing:-.02em;${CHROME}margin-bottom:50px;">${heading}</div>
      ${rows}
    </div>
    <div style="position:absolute;top:0;left:0;width:100%;height:8px;background:linear-gradient(90deg,${C.accent},transparent);"></div>
    ${handle()}`,
    GRID_BG
  )
}

// CTA -> ver la clase gratis
function ctaClase({ url, title, pos = 'center 22%' }) {
  return root(
    `
    <img crossorigin="anonymous" src="${url}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:${pos};" />
    <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(4,15,32,.5) 0%, rgba(4,15,32,.8) 55%, rgba(7,31,61,.97) 100%);"></div>
    ${logoTop()}
    <div style="position:absolute;left:64px;right:64px;bottom:140px;z-index:5;">
      <div style="font-family:${DISPLAY};font-weight:800;font-size:70px;line-height:1.05;letter-spacing:-.02em;${CHROME}margin-bottom:36px;">${title}</div>
      <div style="display:inline-flex;align-items:center;gap:16px;background:${C.accent};color:#fff;font-family:${DISPLAY};font-weight:800;font-size:44px;padding:26px 46px;border-radius:999px;box-shadow:0 0 55px rgba(30,158,255,.8);">▶ Ver la clase gratis</div>
      <div style="margin-top:28px;font-family:${BODY};font-weight:600;font-size:34px;color:#fff;">🔗 Enlace en la bio</div>
    </div>`,
    C.navy
  )
}

const slide = (html) => ({ id: randomUUID(), html, notes: '', previousVersions: [] })

function build(P) {
  return [
    {
      title: 'VSL 01 · El cambio de era',
      caption:
        'Dentro de 2 años habrá 3 tipos de personas. Solo uno sobrevive. 👀\nTe cuento cuál y cómo subirte a la ola de la IA a tiempo en la clase gratuita.\n▶ Enlace en la bio para verla ahora.',
      hashtags: ['InteligenciaArtificial', 'AgenciaDeIA', 'GrowthOps', 'FuturoDelTrabajo', 'AdrianMartinez'],
      slides: [
        cover({
          url: P['adri-laptop-front'],
          kicker: 'El cambio de era',
          title: 'En 2 años habrá 3 tipos de personas',
          pos: 'center 16%',
        }),
        content({
          index: '1',
          heading: 'El que usa Agentes IA',
          body: 'El empresario que los incorpora en su negocio… y crece el doble.',
        }),
        content({
          index: '2',
          heading: 'El que sabe implementarla',
          body: 'El profesional que aprende a trabajar con IA y se la vende a esos empresarios.',
        }),
        content({
          index: '3',
          heading: 'El que compite contra ella',
          body: 'El que la ignora… y acaba desapareciendo. Su negocio o su empleo.',
        }),
        content({
          kicker: 'La verdad',
          heading: 'La ventana se está cerrando',
          body: 'Todavía estás a tiempo de subirte a la ola. Pero más rápido de lo que crees.',
        }),
        ctaClase({ url: P['adri-event-smile'], title: '¿En qué grupo quieres estar?', pos: 'center 18%' }),
      ],
    },
    {
      title: 'VSL 02 · El Peaje de la IA',
      caption:
        'Todas las empresas acabarán usando IA. Igual que todas acabaron teniendo web y email. 🌐\nLa oportunidad no es crear IA: es ayudar a las empresas a usarla.\n▶ Te lo explico entero en la clase gratis (link en bio).',
      hashtags: ['AgenciaDeIA', 'NegociosOnline', 'IAparaNegocios', 'GrowthOps', 'Emprender'],
      slides: [
        cover({
          url: P['adri-event-numbers'],
          kicker: 'El Peaje de la IA',
          title: 'Lo que le pasó a la web… le pasará a la IA',
          pos: 'center 22%',
        }),
        content({
          heading: 'La IA dejará de ser una ventaja',
          body: 'Y pasará a ser una necesidad. Como tener página web o correo electrónico.',
        }),
        content({
          heading: 'Millones de empresas la necesitarán',
          body: 'Pero la inmensa mayoría no sabe ni por dónde empezar.',
        }),
        content({
          kicker: 'Aquí está el negocio',
          heading: 'No en crear IA. En implementarla.',
          body: 'Igual que hoy buscan abogados o agencias de marketing… buscarán a quien sepa aplicar IA.',
        }),
        ctaClase({ url: P['adri-teach-1'], title: 'Descubre el Peaje de la IA', pos: 'center 12%' }),
      ],
    },
    {
      title: 'VSL 03 · No necesitas ser programador',
      caption:
        'La mayor mentira de la IA: que necesitas ser ingeniero. 🚫👨‍💻\nLas empresas no buscan código. Buscan resultados.\n▶ Aprende el modelo real en la clase gratuita (link en bio).',
      hashtags: ['InteligenciaArtificial', 'NoCode', 'AgenciaDeIA', 'GrowthOps', 'Automatización'],
      slides: [
        cover({
          url: P['adri-cafe-work'],
          kicker: 'La gran mentira',
          title: 'No necesitas saber programar',
          pos: '70% 28%',
        }),
        content({
          heading: 'Las empresas no buscan ingenieros',
          body: 'Buscan ahorrar tiempo, captar clientes, responder rápido y reducir costes.',
        }),
        content({
          heading: 'Les da igual el código',
          body: 'Diez líneas de programación o una herramienta no-code. Solo quieren que funcione.',
        }),
        content({
          kicker: 'Tu trabajo',
          heading: 'Resolver problemas, no inventar tecnología',
          body: 'Conviértete en la persona que sabe implementar IA. Esa es la habilidad mejor pagada.',
        }),
        ctaClase({ url: P['adri-laptop-front'], title: 'Así se hace, sin código', pos: 'center 16%' }),
      ],
    },
    {
      title: 'VSL 04 · Qué hace una Agencia de IA',
      caption:
        '¿Qué hace exactamente una Agencia de IA? No inventa tecnología: usa la que ya existe para resolver problemas reales. 🤖\n▶ Clase gratis con el modelo completo (link en bio).',
      hashtags: ['AgenciaDeIA', 'Automatización', 'IAparaNegocios', 'GrowthOps', 'Make'],
      slides: [
        cover({
          url: P['adri-cafe-think'],
          kicker: 'El modelo',
          title: 'Qué hace de verdad una Agencia de IA',
          pos: '70% 28%',
        }),
        list({
          kicker: 'Construye Agentes IA que…',
          heading: 'Automatizan el negocio',
          items: [
            'Responden y recuperan clientes por WhatsApp',
            'Agendan citas y atienden 24/7',
            'Organizan la información y procesos internos',
            'Gestionan departamentos enteros (marketing, contabilidad…)',
          ],
        }),
        content({
          heading: 'No creas tecnología',
          body: 'Utilizas tecnología que YA existe para resolver problemas reales. Eso es todo.',
        }),
        ctaClase({ url: P['adri-class'], title: 'Mira cómo se monta paso a paso', pos: 'center 20%' }),
      ],
    },
    {
      title: 'VSL 05 · Vendes resultados, no tecnología',
      caption:
        'Un cliente no te pide un robot. Te pide dejar de perder clientes por WhatsApp. 📲\nNo vendes IA. Vendes resultados. Y las empresas pagan por resultados.\n▶ Clase gratuita en el link de la bio.',
      hashtags: ['Ventas', 'AgenciaDeIA', 'IAparaNegocios', 'GrowthOps', 'Resultados'],
      slides: [
        cover({
          url: P['adri-event-point'],
          kicker: 'La clave',
          title: 'No vendes IA. Vendes resultados.',
          pos: 'center 22%',
        }),
        content({
          kicker: 'Ejemplo real',
          heading: 'Una inmobiliaria',
          body: 'Cada contacto perdido son miles de euros. La IA responde, califica, agenda y hace seguimiento.',
        }),
        content({
          heading: 'No cuesta dinero. Genera dinero.',
          body: 'Porque evita perder clientes. Por eso el dueño está dispuesto a pagar por ello.',
        }),
        content({
          kicker: 'Recuérdalo',
          heading: 'Las empresas pagan por soluciones',
          body: 'No por tecnología. Y eso hace este modelo mucho más sencillo de lo que imaginas.',
        }),
        ctaClase({ url: P['adri-teach-2'], title: 'Aprende a vender resultados', pos: 'center 12%' }),
      ],
    },
    {
      title: 'VSL 06 · Las 4 claves del éxito',
      caption:
        'El sistema no va de aprender una herramienta. Va de convertir esa herramienta en un negocio. 🔑\nEstas son las 4 claves que enseñamos en Growth Ops.\n▶ Clase gratis completa en la bio.',
      hashtags: ['AgenciaDeIA', 'Emprender', 'GrowthOps', 'NegociosOnline', 'Sistema'],
      slides: [
        cover({
          url: P['adri-event-smile'],
          kicker: 'El sistema',
          title: 'Las 4 claves para vivir de la IA',
          pos: 'center 20%',
        }),
        content({
          index: '1',
          heading: 'Encontrar la oportunidad',
          body: 'Detectar un problema que le está costando mucho dinero a un negocio.',
        }),
        content({
          index: '2',
          heading: 'Paquetizar la solución',
          body: 'Resolverlo, empaquetarlo y ponerle precio: entre 1.500€ y 3.500€.',
        }),
        content({
          index: '3',
          heading: 'Conseguir clientes',
          body: 'Sistemas automáticos con agentes de IA que atraen clientes interesados.',
        }),
        content({
          index: '4',
          heading: 'Escalar a agencia',
          body: 'Equipo, sistemas y estrategia para crecer sin meter más horas ni más dinero.',
        }),
        ctaClase({ url: P['adri-event-numbers'], title: 'Te enseño las 4 claves', pos: 'center 22%' }),
      ],
    },
    {
      title: 'VSL 07 · La habilidad mejor pagada',
      caption:
        'Las herramientas cambian. ChatGPT no existía hace 2 años. 🔄\nLo que permanece es saber ayudar a las empresas a adoptarlas. Esa es la habilidad mejor pagada.\n▶ Clase gratis en la bio.',
      hashtags: ['InteligenciaArtificial', 'Habilidades', 'AgenciaDeIA', 'GrowthOps', 'Futuro'],
      slides: [
        cover({
          url: P['adri-laptop-down'],
          kicker: 'Piénsalo bien',
          title: 'La oportunidad no es la herramienta',
          pos: 'center 20%',
        }),
        content({
          heading: 'Las herramientas caducan',
          body: 'Hace 2 años casi nadie hablaba de ChatGPT. En 5 años habrá otras distintas.',
        }),
        content({
          kicker: 'Lo que permanece',
          heading: 'Saber implementarla',
          body: 'Ser el profesional que ayuda a las empresas a adoptar la tecnología. Eso sí tiene valor.',
        }),
        content({ heading: 'La habilidad que multiplica x2 o x3 el beneficio de una empresa.' }),
        ctaClase({ url: P['adri-mentoring'], title: 'Desarrolla esta habilidad', pos: 'center 30%' }),
      ],
    },
    {
      title: 'VSL 08 · No es teoría, es una empresa real',
      caption:
        'Growth Ops no nació como academia. Nació de una agencia que YA implementaba IA en empresas reales. 🏢\nPrimero el negocio. Después el método.\n▶ Ve cómo funciona en la clase gratuita (bio).',
      hashtags: ['GrowthOps', 'AgenciaDeIA', 'Formación', 'IAparaNegocios', 'AdrianMartinez'],
      slides: [
        cover({
          url: P['adri-mentoring'],
          kicker: 'Por qué Growth Ops',
          title: 'No enseñamos teoría. Enseñamos lo que hacemos.',
          pos: 'center 32%',
        }),
        content({
          heading: 'Primero construimos la agencia',
          body: 'Implementando IA en empresas reales. Después documentamos el sistema. Y luego lo enseñamos.',
        }),
        list({
          kicker: 'El sistema completo',
          heading: '4 pilares',
          items: [
            'Plataforma digital paso a paso',
            'Clases en directo cada semana',
            'Soporte 24/7 (nunca estás solo)',
            'Bolsa de trabajo',
          ],
        }),
        content({
          kicker: 'Lo que medimos',
          heading: 'Resultados, no vídeos vistos',
          body: 'Ver clases no cambia una vida. Construir un negocio con clientes e ingresos, sí.',
        }),
        ctaClase({ url: P['adri-event-smile'], title: 'Entra a ver cómo trabajamos', pos: 'center 20%' }),
      ],
    },
    {
      title: 'VSL 09 · De 1.699€ a Growth Ops',
      caption:
        'Miré mi cuenta: 1.699€. Venía de arruinarme, de una depresión y de perder a mi mejor amigo. 🙏\nTenía dos opciones: aceptarlo o empezar de cero. Elegí empezar.\n▶ Mi historia completa y el modelo, en la clase gratis (bio).',
      hashtags: ['HistoriaReal', 'Mentalidad', 'GrowthOps', 'Emprender', 'AdrianMartinez'],
      slides: [
        cover({
          url: P['adri-laptop-front'],
          kicker: 'Mi historia',
          title: 'El día que me quedaban 1.699€',
          pos: 'center 16%',
        }),
        content({
          heading: 'Casi 10 años en el mundo de la noche',
          body: 'Camarero, promotor, director de discotecas. Desde fuera parecía increíble. Por dentro, ni libertad ni propósito.',
        }),
        content({
          heading: 'Se juntó todo',
          body: 'Mi pareja me dejó. Entré en depresión. Me arruiné. Y perdí a mi mejor amigo, Óscar.',
        }),
        content({
          heading: 'Dos opciones',
          body: 'Aceptar que esa iba a ser mi vida… o empezar desde cero. Elegí empezar.',
        }),
        content({
          kicker: 'Entonces llegó ChatGPT',
          heading: 'Y vi una necesidad gigante',
          body: 'Donde otros veían una herramienta de preguntas, yo vi que toda empresa necesitaría IA.',
        }),
        ctaClase({ url: P['adri-event-smile'], title: 'Así empezó todo', pos: 'center 20%' }),
      ],
    },
    {
      title: 'VSL 10 · Esto no es para todo el mundo',
      caption:
        'Si buscas dinero rápido tocando 2 botones, esto no es para ti. 🚪\nPreferimos pocas personas, pero comprometidas. Empieza por la clase gratuita y decide.\n▶ Link en la bio.',
      hashtags: ['Mentalidad', 'Compromiso', 'AgenciaDeIA', 'GrowthOps', 'Emprender'],
      slides: [
        cover({
          url: P['adri-teach-1'],
          kicker: 'Sé honesto contigo',
          title: 'Esto no es para todo el mundo',
          pos: 'center 12%',
        }),
        content({
          kicker: 'No es para ti si…',
          heading: 'Buscas atajos',
          body: 'Si esperas que la IA lo haga por ti tocando 2 botones, o no quieres aprender una habilidad nueva.',
        }),
        content({
          kicker: 'Sí es para ti si…',
          heading: 'Piensas como empresario',
          body: 'Estás dispuesto a comprometerte y a construir un negocio serio, paso a paso.',
        }),
        content({ heading: 'Hay dos formas de hacer las cosas: a medias, o comprometido.' }),
        ctaClase({ url: P['adri-event-smile'], title: 'Empieza por la clase gratis, Winner', pos: 'center 18%' }),
      ],
    },
  ]
}

async function main() {
  const photos = await uploadPhotos()
  const carousels = build(photos)
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
  console.log('\nListo:', carousels.length, 'carruseles VSL creados.')
}
main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
