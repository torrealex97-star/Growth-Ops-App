// Genera los carruseles de CASOS DE ÉXITO.
// Estilo de marca idéntico a gen-carruseles-adri.mjs (navy + azul eléctrico + cromo).
// Re-ejecutable: borra por título antes de insertar.
//
// Uso:
//   node scripts/gen-carruseles-testimonios.mjs            → todos
//   node scripts/gen-carruseles-testimonios.mjs xavi maxi   → solo esos

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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const BUCKET = 'carrusel-uploads'
const PHOTO_DIR = '/Users/adrianmartinezsegarra/Desktop/Fotos Casos de Exito '

// slug → nombre de fichero en la carpeta del escritorio
const PHOTO_FILES = {
  xavi: 'caso exito xavi HD .png',
  rocio: 'Caso exito rocio.png',
  maxi: 'Caso exito Maxi.png',
  claudia: 'Caso exito Claudia.png',
  joseluis: 'Caso exito jose luis.png',
  adexe: 'Caso exito adexe.png',
  bartomeu: 'Caso exito bartu.png',
  bernard: 'caso exito bernat.png',
  mark: 'Caso exito Marc.png',
  miguel: 'caso exito miguel hd.png',
  maria: 'caso exito maria HD .png',
  alberto: 'caso exito empresario alberto .png',
  blanca: 'caso exito blanca.png',
  isabel: 'caso exito isabel .png',
  jesus: 'caso exito jesus .png',
  carolina: 'caso exito carolina .png',
  stefano: 'caso exito stefano .png',
  mariapaz: 'caso exito maria paz .png',
}

// ---- brand ----
const C = {
  navy: '#071f3d',
  navy2: '#0b2c52',
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

const CHROME = `background:linear-gradient(180deg,#ffffff 0%,#dcecff 50%,#7fbaf0 100%);-webkit-background-clip:text;background-clip:text;color:transparent;`

const root = (inner, bg) =>
  `<div style="position:relative;width:1080px;height:1350px;overflow:hidden;font-family:${BODY},sans-serif;${bg}">${inner}</div>`

const brandRow = (top = 60) =>
  `<div style="position:absolute;top:${top}px;left:64px;display:flex;align-items:center;gap:12px;z-index:5;">
    <span style="display:inline-flex;width:44px;height:44px;border-radius:12px;background:${C.accent};box-shadow:0 0 30px rgba(30,158,255,.8);align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:800;font-family:${DISPLAY};">S</span>
  </div>`

const handle = () =>
  `<div style="position:absolute;bottom:56px;left:64px;display:flex;align-items:center;gap:12px;font-family:${DISPLAY};font-weight:700;font-size:26px;letter-spacing:.02em;color:rgba(255,255,255,.85);z-index:5;">
    <span style="display:inline-flex;width:40px;height:40px;border-radius:11px;background:${C.accent};box-shadow:0 0 26px rgba(30,158,255,.75);align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:800;">S</span>
  </div>`

const swipe = () =>
  `<div style="position:absolute;bottom:58px;right:64px;font-family:${DISPLAY};font-weight:600;font-size:24px;color:${C.accent2};letter-spacing:.04em;z-index:5;">desliza →</div>`

// ---------- SLIDE 1: portada con la foto real en tarjeta (respeta proporción) ----------
function cover({ url, name, label = 'Caso de éxito', hook }) {
  const size = hook.length > 62 ? 66 : hook.length > 44 ? 74 : 84
  const inner = `
    ${brandRow()}
    <div style="position:absolute;top:150px;left:64px;right:64px;bottom:130px;display:flex;flex-direction:column;justify-content:center;gap:44px;z-index:4;">
      <div>
        <div style="display:inline-block;font-family:${DISPLAY};font-weight:700;font-size:23px;letter-spacing:.18em;text-transform:uppercase;color:${C.accent2};background:rgba(30,158,255,.14);border:1px solid rgba(30,158,255,.4);padding:10px 20px;border-radius:999px;margin-bottom:26px;">${label} · ${name}</div>
        <div style="font-family:${DISPLAY};font-weight:800;font-size:${size}px;line-height:1.04;letter-spacing:-.02em;${CHROME}">${hook}</div>
      </div>
      <div style="position:relative;border-radius:28px;overflow:hidden;border:2px solid rgba(30,158,255,.55);box-shadow:0 0 70px rgba(30,158,255,.35), 0 24px 60px rgba(0,0,0,.45);">
        <img crossorigin="anonymous" src="${url}" style="display:block;width:100%;height:auto;" />
      </div>
    </div>
    ${swipe()}`
  return root(inner, GRID_BG)
}

// ---------- SLIDES DE CONTENIDO ----------
function content({ index, kicker, heading, body, big }) {
  const bigBlock = big
    ? `<div style="font-family:${DISPLAY};font-weight:800;font-size:${big.length > 9 ? 112 : 150}px;line-height:1;${CHROME}margin-bottom:24px;">${big}</div>`
    : ''
  const idxBlock = index
    ? `<div style="font-family:${DISPLAY};font-weight:800;font-size:40px;color:${C.accent};width:88px;height:88px;border-radius:20px;background:rgba(30,158,255,.12);border:1px solid rgba(30,158,255,.35);display:flex;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(30,158,255,.25);margin-bottom:40px;">${index}</div>`
    : ''
  const kickerBlock = kicker
    ? `<div style="font-family:${DISPLAY};font-weight:700;font-size:26px;letter-spacing:.16em;text-transform:uppercase;color:${C.accent2};margin-bottom:26px;">${kicker}</div>`
    : ''
  const hSize = heading.length > 52 ? 56 : heading.length > 34 ? 62 : 74
  const inner = `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 90px;">
      ${idxBlock}${kickerBlock}${bigBlock}
      <div style="font-family:${DISPLAY};font-weight:800;font-size:${hSize}px;line-height:1.05;letter-spacing:-.02em;${CHROME}margin-bottom:${body ? 34 : 0}px;">${heading}</div>
      ${body ? `<div style="font-family:${BODY};font-weight:400;font-size:38px;line-height:1.42;color:rgba(226,240,255,.9);max-width:860px;">${body}</div>` : ''}
    </div>
    <div style="position:absolute;top:0;left:0;width:100%;height:8px;background:linear-gradient(90deg,${C.accent},transparent);"></div>
    ${handle()}`
  return root(inner, GRID_BG)
}

// ---------- CTA ----------
// Espejo de ctaSlide() en lib/carruseles/caso-exito.ts: todos los carruseles cierran
// llevando a la clase gratuita del enlace de la bio.
const CTA_TITLE = 'Clase gratuita para crear tu Agencia de IA'
const CTA_PILL = '🔗 Enlace en la bio'
const CTA_CAPTION_LINE = 'Tienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗'

function cta({ lead }) {
  const leadBlock = lead
    ? `<div style="font-family:${DISPLAY};font-weight:700;font-size:34px;line-height:1.25;color:${C.accent2};margin-bottom:28px;">${lead}</div>`
    : ''
  const inner = `
    ${brandRow()}
    <div style="position:absolute;left:64px;right:64px;top:50%;transform:translateY(-50%);z-index:5;">
      ${leadBlock}
      <div style="font-family:${DISPLAY};font-weight:800;font-size:74px;line-height:1.04;letter-spacing:-.02em;${CHROME}margin-bottom:44px;">${CTA_TITLE}</div>
      <div style="display:inline-flex;align-items:center;gap:16px;background:${C.accent};color:#fff;font-family:${DISPLAY};font-weight:800;font-size:44px;padding:26px 44px;border-radius:999px;box-shadow:0 0 50px rgba(30,158,255,.75);">${CTA_PILL}</div>
      <div style="margin-top:34px;font-family:${BODY};font-weight:500;font-size:32px;color:rgba(226,240,255,.85);">💾 Guarda este post</div>
    </div>
    <div style="position:absolute;bottom:0;left:0;width:100%;height:10px;background:linear-gradient(90deg,transparent,${C.accent});"></div>`
  return root(inner, GRID_BG)
}

// ============================================================
//                        TESTIMONIOS
// ============================================================
function buildCarousels(P) {
  const T = []
  const add = (slug, title, caption, hashtags, slides) => T.push({ slug, title, caption, hashtags, slides })

  const HT = (...extra) => ['CasoDeExito', 'AgenciaDeIA', 'CasoDeExito', 'InteligenciaArtificial', ...extra]

  // ---------------- 1 · XAVI ----------------
  add(
    'xavi',
    'CASO · Xavi — 12.000€ en su primer mes fuerte',
    'Estuvo 9 meses dudando si entrar. Cuando por fin dio el paso, facturó 12.000€ en un mes. 🚀\nVenía del mundo de la noche, sin nada que ver con la IA. Hoy tiene su propia agencia y trabaja desde donde quiere.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Emprender', 'LibertadFinanciera'),
    [
      cover({
        url: P.xavi,
        name: 'Xavi',
        hook: '9 meses dudando. 30 días después, 12.000€ facturados.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Venía de la noche',
        body: 'Chaval de barrio, del sector de las discotecas. Escéptico: «¿qué me va a enseñar este de inteligencia artificial?». Estuvo 9 meses dándole vueltas antes de entrar.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Dejó de dudar y eligió un nicho',
        body: 'En vez de ofrecer «IA» a todo el mundo, se ennichó: contenido, avatares y captación automática de clientes para infoproductores y empresas.',
      }),
      content({ kicker: 'Punto B', big: '12.000€', heading: 'Facturados en su primer mes fuerte' }),
      content({
        kicker: 'Y no fue un pico suelto',
        heading: '3.000-4.000€/mes recurrentes',
        body: 'Con picos de 8.000€. Y libertad total de horario: puede estar un miércoles laborable de vacaciones en Punta Cana.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'El sistema de IA Winners aplicado a un nicho',
        body: 'Contenido + captación automatizada, empaquetado como servicio. No hacía falta ser técnico: hacía falta un método y ejecutarlo.',
      }),
      cta({ lead: '¿Cuánto tiempo más vas a dudar tú?' }),
    ]
  )

  // ---------------- 2 · ROCÍO ----------------
  add(
    'rocio',
    'CASO · Rocío — 6.500€ en sus 2 primeros clientes',
    'Ya trabajaba en marketing. Le faltaba una cosa: saber venderlo con IA. 💡\nCerró sus dos primeros clientes por 6.500€ en ticket combinado, y hoy dedica su tiempo a lo creativo, no a lo operativo.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('MarketingDigital', 'AgenciaDeMarketing'),
    [
      cover({
        url: P.rocio,
        name: 'Rocío',
        hook: 'Ya trabajaba en marketing. Le faltaba venderlo con IA.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Enterrada en tareas sin valor',
        body: 'Sabía de marketing, pero se le iba el día en lo operativo. Quería dedicarse a sus clientes con creatividad, no apagando fuegos.',
      }),
      content({
        kicker: 'El giro',
        heading: 'No era conocimiento técnico. Era mentalidad y sistema comercial',
        body: 'Lo que le cambió el juego fue el acompañamiento de la comunidad y saber cómo estructurar y cerrar una propuesta.',
      }),
      content({ kicker: 'Punto B', big: '6.500€', heading: 'En ticket combinado de sus 2 primeros clientes' }),
      content({
        kicker: 'Qué les vendió',
        heading: 'Uno sencillo. Uno integral.',
        body: 'El primero con una solución simple. El segundo, completo: CRM y funnels de venta con IA integrada.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'Agencia de IA + marketing',
        body: 'Sumó la capa de IA a lo que ya sabía hacer. No empezó de cero: multiplicó lo que ya tenía.',
      }),
      cta({ lead: 'Tu experiencia ya vale. Solo te falta el vehículo.' }),
    ]
  )

  // ---------------- 3 · MAXI ----------------
  add(
    'maxi',
    'CASO · Maxi — 23.000€ netos en 30 días (inmobiliaria)',
    'De hacer llamadas frías puerta a puerta a facturar 23.000€ netos en 30 días sin pisar la calle. 🏠🤖\nNo abandonó su sector: lo reinventó con IA.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Inmobiliaria', 'Automatización'),
    [
      cover({
        url: P.maxi,
        name: 'Maxi',
        hook: 'De llamadas frías a 23.000€ en 30 días, sin pisar la calle.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Quemado en el sector inmobiliario',
        body: 'Llamadas frías, tú a tú, todo el día en la calle. Cansado y desmotivado porque el negocio no crecía ni facturaba más.',
      }),
      content({
        kicker: 'El giro',
        heading: 'No cambió de sector. Cambió el modelo.',
        body: 'Montó una inmobiliaria 100% online apalancada en IA, en lugar de tirar por la borda todo lo que ya sabía del sector.',
      }),
      content({ kicker: 'Punto B', big: '23.000€', heading: 'Netos facturados en los últimos 30 días' }),
      content({
        kicker: 'Cómo funciona',
        heading: 'La IA capta y filtra. Él solo cierra.',
        body: 'El sistema atrae propietarios interesados en vender, los califica automáticamente y solo le pasa los que están listos.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'Captación + calificación automática de leads',
        body: 'El mismo sistema aplicado a su propio sector. Ahí está la clave: tu experiencia + IA.',
      }),
      cta({ lead: 'Reinventa tu sector con IA, no lo abandones.' }),
    ]
  )

  // ---------------- 4 · CLAUDIA ----------------
  add(
    'claudia',
    'CASO · Claudia — primer cliente en mes y medio',
    'Mes y medio dentro. Primer cliente cerrado y varias propuestas en curso. ⚡\nNo necesitaba años de experiencia técnica: necesitaba saber cerrar y gestionar clientes.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('MarketingDigital', 'PrimerCliente'),
    [
      cover({
        url: P.claudia,
        name: 'Claudia',
        hook: 'Mes y medio dentro. Primer cliente cerrado.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Marketing digital tradicional',
        body: 'Buscaba un cambio de rumbo. Sabía vender, pero no tenía nada diferencial que ofrecer frente al resto del mercado.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Cambió la mentalidad antes que la técnica',
        body: 'Lo que la desbloqueó no fue aprender más herramientas: fue tener una estructura clara de cómo cerrar y gestionar un cliente.',
      }),
      content({ kicker: 'Punto B', big: '45 días', heading: 'Y su primer cliente ya firmado' }),
      content({
        kicker: 'Y no se queda ahí',
        heading: 'Varias propuestas en curso',
        body: 'Con nuevas empresas ya en conversación. El primer cliente es el más difícil; después el sistema se repite.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'Estructura comercial + mentalidad',
        body: 'El conocimiento técnico se aprende. Lo que casi nadie te enseña es cómo poner precio, presentar y cerrar.',
      }),
      cta({ lead: 'No necesitas años. Necesitas el sistema correcto.' }),
    ]
  )

  // ---------------- 5 · JOSÉ LUIS ----------------
  add(
    'joseluis',
    'CASO · José Luis — 16 años corporativos → IA para conciertos',
    '16 años de carrera corporativa. Hoy diseña campañas de IA para giras y conciertos internacionales. 🎤🤖\nVendió su primera automatización al 4º día de formación y recuperó la inversión antes de terminarla.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Ecuador', 'Consultoría', 'Automatización'),
    [
      cover({
        url: P.joseluis,
        name: 'José Luis',
        hook: '16 años corporativos. Hoy hace IA para conciertos internacionales.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Un consultor más en el mercado',
        body: '16 años como gerente de producto y gerente país de una multinacional. Emprendió con asesoría a empresas, pero ofrecía lo mismo que todos: cero diferenciación.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Validó rápido y escaló',
        body: 'Empezó con la formación de automatizaciones. Al ver resultados en días, pasó al programa completo. Hoy lleva 15 meses en el ecosistema.',
      }),
      content({ kicker: 'Punto B', big: '4 días', heading: 'Tardó en vender su primera automatización' }),
      content({
        kicker: 'Hoy',
        heading: 'Estrategias de IA para eventos masivos',
        body: 'Conciertos, giras de tributo internacionales y distribuidores máster de marcas. Y puede «cerrar el kiosco» para estar con su familia y acompañar a su hijo.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'Recuperó la inversión en 1 mes',
        body: 'Automatizaciones primero, programa completo después. La experiencia que ya tenía, con un vehículo que sí escala.',
      }),
      cta({ lead: 'Tu experiencia + el vehículo correcto = resultado.' }),
    ]
  )

  // ---------------- 6 · ADEXE ----------------
  add(
    'adexe',
    'CASO · Adexe — clientes con 0 seguidores en Instagram',
    'Abrió su Instagram desde cero. 0 publicaciones, 0 seguidores. Y ya tenía clientes cerrados. 📵💰\nNo necesitas marca personal para montar una agencia de IA. Necesitas sistema.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Londres', 'MarcaPersonal', 'Automatización'),
    [
      cover({
        url: P.adexe,
        name: 'Adexe',
        hook: '0 seguidores en Instagram. Clientes cerrados igual.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Ya había visto de todo en YouTube',
        body: 'Llevaba tiempo investigando IA por su cuenta y en formaciones sueltas. Sentía que incluso sabía más que lo que le enseñaban. Nada le aportaba algo nuevo.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Devoró el Master en días',
        body: 'Entró por el Master Intensivo, lo terminó en cuestión de días, y al ver el potencial real escaló al programa completo.',
      }),
      content({ kicker: 'Punto B', big: '0', heading: 'Publicaciones en redes cuando cerró sus primeros clientes' }),
      content({
        kicker: 'Doble beneficio',
        heading: 'Montó su agencia y mejoró su propio negocio',
        body: 'Aplicó lo aprendido a su Airbnb además de vender el servicio a terceros. Y ya tiene reunión para cerrar un cliente más grande: desarrollo de app.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'Comunidad + red de contactos',
        body: 'Resolvía dudas en tiempo real con la comunidad y captó por contactos. Sin esperar a «tener audiencia» para empezar.',
      }),
      cta({ lead: 'No necesitas audiencia. Necesitas sistema.' }),
    ]
  )

  // ---------------- 7 · BERNARD ----------------
  add(
    'bernard',
    'CASO · Bernard — 2h/día liberadas en 2 semanas',
    '2 semanas dentro. Una sola automatización. 2 horas diarias liberadas de su equipo. ⏱️\nSi tu agencia no automatiza, tu competencia sí lo hará.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('AgenciaDeMarketing', 'MetaAds', 'Automatización'),
    [
      cover({
        url: P.bernard,
        name: 'Bernard',
        hook: '2 semanas dentro. Ya liberó 2 horas diarias de su equipo.',
      }),
      content({
        kicker: 'Punto A',
        heading: '5 años de agencia. Todo a mano.',
        body: 'Agencia de marketing y escuela de formación en publicidad. Mucho trabajo manual en el equipo y la sensación de que si no entraba en la ola de la IA, se quedaba atrás.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Empezó por dentro, no por fuera',
        body: 'En vez de salir a vender IA, automatizó primero sus propios procesos internos. Resultado inmediato y aprendizaje real.',
      }),
      content({ kicker: 'Punto B', big: '2 h/día', heading: 'Liberadas con una sola automatización' }),
      content({
        kicker: 'Siguiente paso',
        heading: 'IA en su propia captación',
        body: 'De lead de Meta Ads a cita agendada, sin intervención manual. Lo que aplica en casa se lo vende luego al cliente.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'Automatización de procesos internos',
        body: 'Con apenas 2 semanas en la academia. No hace falta terminar el programa para empezar a ganar tiempo.',
      }),
      cta({ lead: 'Si tu agencia no automatiza, tu competencia sí lo hará.' }),
    ]
  )

  // ---------------- 8 · MARK ----------------
  add(
    'mark',
    'CASO · Mark — inversión recuperada en 3 días',
    '3 días dentro. Primera venta cerrada. Inversión recuperada. ⚡\nY sin tocar la parte técnica: fue directo al módulo de servicios y precios.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Ventas', 'Infoproductos', 'Closer'),
    [
      cover({
        url: P.mark,
        name: 'Mark',
        hook: '3 días dentro. Primera venta cerrada. Inversión recuperada.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Negocios digitales sin la capa de IA',
        body: 'Ya montaba embudos de venta e infoproductos para sus clientes. El problema: muchos no podían permitirse contratar más gente para escalar.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Fue directo a lo comercial',
        body: 'No intentó dominar lo técnico primero. Fue al módulo de servicios paquetizados y precios, y se apoyó en el equipo técnico de la comunidad para entregar.',
      }),
      content({ kicker: 'Punto B', big: '3 días', heading: 'Y la inversión ya estaba recuperada' }),
      content({
        kicker: 'Con qué',
        heading: 'Una sola conversación comercial',
        body: 'Y ya tiene más reuniones agendadas, incluida una para un proyecto más grande: desarrollo de una aplicación.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'Perfil comercial + equipo técnico de la comunidad',
        body: 'Si sabes vender, no necesitas programar. Necesitas qué vender, a qué precio y quién lo entrega.',
      }),
      cta({ lead: 'Al éxito le gusta la velocidad.' }),
    ]
  )

  // ---------------- 9 · MIGUEL ----------------
  add(
    'miguel',
    'CASO · Miguel — 11 clientes recurrentes, ~5.000€/mes',
    'De empleado en una fintech, aburrido y sin saber nada de tecnología, a dueño de una agencia de IA con 11 clientes recurrentes. 📈\nLa clave que él mismo señala: no saltarse ningún paso del método.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Recurrente', 'Inmobiliaria', 'TrabajoRemoto'),
    [
      cover({
        url: P.miguel,
        name: 'Miguel',
        hook: '11 clientes recurrentes. De empleado de fintech a dueño de agencia de IA.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Divagando entre vídeos de YouTube',
        body: 'Empleado en una fintech, con un trabajo metódico que le aburría. Sin saber nada de tecnología. Veía vídeos sueltos (incluso en inglés) y probaba herramientas sin ningún resultado real.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Un método. Sin saltarse pasos.',
        body: 'Entró con el Master Intensivo en octubre de 2024 y escaló al programa completo. Dejó de saltar de vídeo en vídeo y siguió una estructura clara.',
      }),
      content({ kicker: 'Punto B', big: '11', heading: 'Clientes recurrentes firmados' }),
      content({
        kicker: 'Su servicio estrella',
        heading: '2.000€ setup + 497€/mes',
        body: 'Empaquetó landing, chatbot, agentes de voz y de texto para el sector inmobiliario. Hoy: ~5.000€/mes recurrentes sin contar setups. Objetivo 2026: 8.000€/mes.',
      }),
      content({
        kicker: 'Lo que no esperaba superar',
        heading: 'El miedo a vender',
        body: 'Nunca había hablado con clientes. Hoy es lo que sostiene su negocio. El miedo no desaparece: se atraviesa.',
      }),
      cta({ lead: 'El miedo se supera dando el paso con el sistema correcto.' }),
    ]
  )

  // ---------------- 10 · MARÍA ----------------
  add(
    'maria',
    'CASO · María — de no usar ChatGPT a dominar N8N en 4 meses',
    'No sabía ni usar ChatGPT. 4 meses después entiende Make, N8N, Go High Level y Claude Code. 👩‍💻\nMaestra Montessori, 29 años, cero perfil técnico. Rompió el mito de que hay que programar.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('DesdeCero', 'SinProgramar', 'N8N'),
    [
      cover({
        url: P.maria,
        name: 'María',
        hook: 'No sabía ni usar ChatGPT. 4 meses después: N8N, Make y Claude Code.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Maestra Montessori, cero absoluto',
        body: '29 años. No usaba ni ChatGPT antes de entrar. Le encanta moverse y vivir en distintos países, pero sabía que la docencia tradicional no le daría esa libertad.',
      }),
      content({
        kicker: 'Su miedo real',
        heading: 'No era «¿será buena la academia?». Era «¿seré yo capaz?»',
        body: 'Asociaba la IA con pantallas de código que no entendía. Se comparaba con su hermano informático y se veía fuera de juego.',
      }),
      content({ kicker: 'Punto B', big: '6 días', heading: 'Tardó en completar el Master Intensivo' }),
      content({
        kicker: '4 meses después',
        heading: 'Entiende la lógica de automatizar',
        body: 'Ha avanzado en Make, Go High Level, N8N y Claude Code: un 25% del contenido del IA Expert. Y ha roto el mito de «necesito programar para montar una agencia de IA».',
      }),
      content({
        kicker: 'Su siguiente reto',
        heading: 'Ya no es conocimiento. Es lanzarse a vender.',
        body: 'Lo que más le ayudó: la guía paso a paso en vez de vídeos sueltos, y una comunidad que al principio abrumaba y hoy entiende sin problema.',
      }),
      cta({ lead: 'No hace falta ser programador. Hace falta empezar.' }),
    ]
  )

  // ---------------- 11 · ALBERTO ----------------
  add(
    'alberto',
    'CASO · Alberto — de 5-6h/día a 1h, por 50€/mes',
    'Se pasaba 5-6 horas al día metiendo datos a mano. Hoy trabaja 1 hora, y solo en lo que le gusta. 🤖\nCoste de mantener todo su sistema de automatizaciones: ~50€/mes.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Automatización', 'N8N', 'Empresarios'),
    [
      cover({
        url: P.alberto,
        name: 'Alberto',
        hook: '5-6 horas al día metiendo datos. Hoy: 1 hora, y solo en lo que le gusta.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Programación de hace 30 años',
        body: 'Empresario con conocimientos ya obsoletos. Cada día: facturas a mano, 24 datos del precio de la luz apuntados hora a hora, gestión tediosa y errores frecuentes.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Aprendió N8N. Sin programar.',
        body: 'Empezó con algo sencillo: el tracking del precio de la luz. Desde ahí fue escalando hasta un ecosistema completo de agentes.',
      }),
      content({ kicker: 'Punto B', big: '1 h/día', heading: 'Es todo lo que trabaja ahora' }),
      content({
        kicker: 'Qué automatizó',
        heading: 'Facturas, banco, recibos y WhatsApp',
        body: 'Lee facturas y actualiza el CRM solo. Detecta cobros bancarios. Genera recibos por domiciliación. Y un agente gestiona su WhatsApp: identifica si es cliente, comercial o desconocido y responde según toca.',
      }),
      content({
        kicker: 'El número que lo dice todo',
        heading: '~50€/mes de coste',
        body: 'Su propia valoración de lo que pagaría si un tercero le hubiera desarrollado ese agente: «por menos de 3.000-4.000€ no se paga».',
      }),
      cta({ lead: 'Un trabajador full-time por 50€ al mes.' }),
    ]
  )

  // ---------------- 12 · BLANCA ----------------
  add(
    'blanca',
    'CASO · Blanca — su primer chatbot en 4 meses',
    'Su miedo no era «seré capaz». Era «voy a elegir la academia equivocada». 😰\nComparó varias, hizo una sola llamada y 4 meses después ya tiene su primer chatbot funcionando y sabe poner precio.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('AgenciaDeMarketing', 'Chatbot', 'SinTitulo'),
    [
      cover({
        url: P.blanca,
        name: 'Blanca',
        hook: 'Comparó varias academias por miedo a equivocarse.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Fija en agencias de publicidad',
        body: 'Veía el auge de la IA en su propio sector y sabía que sería la habilidad mejor pagada de los próximos años. Pero no quería equivocarse eligiendo dónde formarse.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Una sola llamada y se quedó',
        body: 'Comparó opciones, habló con IA Winners y decidió. Lo que más valora: la estructura del contenido y tener compañeros a los que preguntar.',
      }),
      content({ kicker: 'Punto B', big: '4 meses', heading: 'Y su primer chatbot ya funcionando' }),
      content({
        kicker: 'Qué sabe hacer ya',
        heading: 'Contenido y citas en automático',
        body: 'Automatizaciones de generación de contenido para redes y de agendamiento de citas. Todo partiendo de usar ChatGPT a nivel usuario.',
      }),
      content({
        kicker: 'El cambio más grande',
        heading: 'De «ni idea de qué precio poner» a paquetizar',
        body: 'Con las plantillas y los GPTs de la academia para la parte comercial. Su conclusión: «todo se gana con la actitud».',
      }),
      cta({ lead: 'Nadie te va a pedir un título. Te van a pedir resultados.' }),
    ]
  )

  // ---------------- 13 · ISABEL ----------------
  add(
    'isabel',
    'CASO · Isabel — 25 años de funcionaria → agencia de IA',
    '25 años de funcionaria con 18 más por delante y el mismo sueldo garantizado. 🔒\nUn año como autónoma después: igualó sus 2.500€/mes, pero sin techo. Y los viernes lleva a sus hijos a la piscina.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Funcionaria', 'LibertadFinanciera', 'AgenciaDeMarketing'),
    [
      cover({
        url: P.isabel,
        name: 'Isabel',
        hook: '25 años de funcionaria. Un año de agencia de IA. Mismo sueldo, cero techo.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Sueldo digno con techo de cristal',
        body: '2.500€ al mes y 18 años más hasta la jubilación con exactamente la misma proyección. En paralelo vendía funnels y webs como freelance, pero admite que era «caos y desorden».',
      }),
      content({
        kicker: 'El giro',
        heading: 'Aprendió a paquetizar, no solo a hacer',
        body: 'Ya dominaba parte de lo técnico. Lo que le faltaba: cómo empaquetar servicios de IA y explicarle al cliente qué es realista esperar. «Vender una realidad, no lo que se lleva».',
      }),
      content({ kicker: 'Punto B', big: '2.500€', heading: 'Igualados en su primer año como autónoma' }),
      content({
        kicker: 'Su caso cliente',
        heading: '60 emails diarios, gestionados solos',
        body: 'Una empresa con 107 apartamentos y 400 inquilinos recibía 50-60 emails/día de incidencias. Hoy un agente por WhatsApp clasifica, prioriza por urgencia y reparte el seguimiento al equipo.',
      }),
      content({
        kicker: 'Lo que más ha cambiado',
        heading: 'Ya no le preocupa el mes que viene',
        body: 'Puede llevar a sus hijos a la piscina los viernes y elegir cuándo irse de vacaciones. Objetivo declarado: 5.000€/mes recurrentes.',
      }),
      cta({ lead: 'El miedo no está en intentarlo. Está en seguir donde ya no quieres estar.' }),
    ]
  )

  // ---------------- 14 · JESÚS ----------------
  add(
    'jesus',
    'CASO · Jesús — 6 clientes, ticket medio 2.800€',
    'De poner cachimbas en discotecas a cerrar 6 clientes de IA con ticket medio de 2.800€. 🚀\nNivel de partida: 2 sobre 10. En 5 meses, agencia montada con un equipo de 4.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Hosteleria', 'Equipo', 'PrimerCliente'),
    [
      cover({
        url: P.jesus,
        name: 'Jesús',
        hook: 'De poner cachimbas en discotecas a 6 clientes de IA.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Toda la vida de temporada',
        body: 'Camarero de cachimbas, encargado de sala, monitor deportivo, campamentos, cuidador en una guardería en Irlanda. Nivel en IA: 2-3 sobre 10.',
      }),
      content({
        kicker: 'Lo que quería evitar',
        heading: '«Para vivir de temporadas tienes que bregar en hostelería»',
        body: 'Un patrón que ya conocía de memoria y que no quería repetir el resto de su vida.',
      }),
      content({ kicker: 'Punto B', big: '6', heading: 'Clientes captados en 5 meses. 4 casi cerrados.' }),
      content({
        kicker: 'Cómo empezó',
        heading: 'El primer proyecto, gratis',
        body: 'Gestión documental de facturas con dashboard para el negocio de un familiar, como caso de prueba. Desde ahí escaló a clientes de pago: fisioterapia, clínica dental y extraescolares.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'Equipo de 4 + GPT calculador de precios',
        body: 'Se unió con 2 desarrolladores y 2 closers que conoció en un piso compartido en Dublín. Ticket medio: ~2.800€ de setup. La inversión, rentabilizada antes de cobrar el primer proyecto.',
      }),
      cta({ lead: 'No es cuestión de qué formación. Es cuestión de hacerlo.' }),
    ]
  )

  // ---------------- 15 · CAROLINA ----------------
  add(
    'carolina',
    'CASO · Carolina — 5 clientes y ~10.000€ en 1 mes',
    'Nunca había emprendido. Un mes de actividad comercial real después: 5 clientes y casi 10.000€ facturados. 🏥🤖\nMontó su agencia con su marido y su antigua jefa, especializada en salud.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Salud', 'Clinicas', 'GoHighLevel'),
    [
      cover({
        url: P.carolina,
        name: 'Carolina',
        hook: 'Nunca fue emprendedora. Un mes después: 5 clientes y casi 10.000€.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Crecía a costa de no ver a sus hijos',
        body: 'Años de marketing en escuelas de negocio y en Doctoralia. Siempre en reuniones, sin tiempo para aprender y sin poder recoger a sus hijos del colegio.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Hizo el Master en su baja de maternidad',
        body: 'Al volver al trabajo sintió que ya no encajaba: «estoy aquí haciendo el mismo marketing de toda la vida». Entre octubre y noviembre lo dejó.',
      }),
      content({ kicker: 'Punto B', big: '~10.000€', heading: 'Facturados en su primer mes comercial real' }),
      content({
        kicker: 'Qué vendió',
        heading: 'Recepcionista de IA + CRM para clínicas',
        body: '5 clientes en un mes: una clínica en Argentina, dos en México, dos despachos de abogados y uno en Canarias captado dentro de la propia comunidad. Una campaña de Google Ads de 80€ le trajo un cliente directo.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'Paquetización + Go High Level',
        body: 'Paquetizar IA no es como paquetizar marketing: hay que contemplar tokens y minutos de voz. Y cuando necesitó ayuda para entregar, 23 alumnos de la comunidad se ofrecieron a colaborar.',
      }),
      cta({ lead: 'No es lo mismo ganar dinero con un salario que ganártelo tú misma.' }),
    ]
  )

  // ---------------- 16 · STEFANO ----------------
  add(
    'stefano',
    'CASO · Stefano — dev sin trabajo → agencia desde su autocaravana',
    'Casi un año buscando trabajo de programador sin encontrarlo. 🛠️\nHoy tiene su agencia de IA y trabaja con Starlink desde la autocaravana que construyó él mismo.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('Desarrolladores', 'Nomada', 'N8N'),
    [
      cover({
        url: P.stefano,
        name: 'Stefano',
        hook: 'Un año sin encontrar trabajo de programador. Hoy vive y trabaja desde su autocaravana.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Desarrollador móvil sin trabajo estable',
        body: 'Casi un año buscando activamente en su nicho (iOS y Android) sin encontrar nada. Y con la mentalidad clásica de dev: pensar siempre en euros por hora.',
      }),
      content({
        kicker: 'El giro',
        heading: 'Aprendió a cobrar por valor, no por horas',
        body: 'Su primer cliente lo cerró en un día de desarrollo... y cobró 100€. Reconoce que valía mucho más: «esta automatización equivale a mes y medio de una secretaria, que además trabaja 24 horas».',
      }),
      content({
        kicker: 'Punto B',
        heading: 'Ya no depende de un solo nicho técnico',
        body: 'Antes solo podía trabajar con quien necesitara una app. Ahora cualquier negocio es cliente potencial.',
      }),
      content({
        kicker: 'Lo que construye hoy',
        heading: 'N8N + Claude Code',
        body: 'Un sistema que ahorra a su padre 5-6 horas al mes generando informes desde PDFs, en producción desde hace 3 meses. Y otro para su hermano, replicando por scraping un proceso que la empresa no exponía por API.',
      }),
      content({
        kicker: 'El vehículo',
        heading: 'Contenido just-in-time',
        body: 'No se ha terminado la academia: busca la lección concreta justo antes de necesitarla para cerrar o entregar. El módulo que más le cambió: venta por valor.',
      }),
      cta({ lead: 'El mundo necesitará menos devs y muchos más automatizadores.' }),
    ]
  )

  // ---------------- 17 · MARÍA PAZ (proceso, sin cifras) ----------------
  add(
    'mariapaz',
    'CASO · María Paz — gerente de IT que dejó de ser empleada',
    'Era gerente de IT. No sabía qué era Make ni N8N. 4 meses después desarrolla sus propias soluciones de IA. 👩‍💻\nY es honesta: todavía no ha cerrado su primera venta. Pero no tiene plan B, porque este es el plan A.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('DesdeCero', 'IT', 'Networking'),
    [
      cover({
        url: P.mariapaz,
        name: 'María Paz',
        hook: 'No sabía qué era Make ni N8N. Hoy desarrolla sus propias soluciones de IA.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Gerente de IT, con un pensamiento que no se iba',
        body: '«¿Por qué sigo trabajando como empleada?». Años de experiencia, pero entregándole todo su conocimiento al dueño de la compañía sin sentir que se valoraba.',
      }),
      content({
        kicker: 'Su miedo real',
        heading: 'No era el dinero. Era estar sola.',
        body: '«Siempre me he creído capaz». Lo que le daba miedo era pasar de trabajar con equipos y áreas a ejecutar todas las ideas ella sola.',
      }),
      content({
        kicker: 'El giro',
        heading: '«Vi que no se estaba vendiendo humo»',
        body: 'Ya había pasado por otros cursos y otros mentores sin quedar satisfecha. Vio un directo de 4 horas con resultados reales y entró sin pensarlo. El precio la sorprendió, pero no la frenó.',
      }),
      content({ kicker: 'Punto B', big: '+8', heading: 'Comerciales con los que ya colabora' }),
      content({
        kicker: 'Cómo se posicionó',
        heading: 'Eligió el lado técnico y se apalancó en los comerciales',
        body: 'Desarrolla soluciones, las publica y busca perfiles comerciales dentro de la academia que las vendan. Ya entra en reuniones con clientes a presentar y personalizar demos.',
      }),
      content({
        kicker: 'Y lo cuenta sin filtros',
        heading: '4 meses. Todavía sin cerrar. Y sin plan B.',
        body: '«Entré diciendo: yo voy a ser el caso de éxito que en dos semanas tiene un cliente». No pasó. Lo que sí tiene: el networking que no encuentra fuera, y profesores que le resuelven en 5 minutos lo que llevaba 3 días atascada.',
      }),
      cta({ lead: 'Esto no es magia. Pero funciona si lo trabajas.' }),
    ]
  )

  // ---------------- 18 · BARTOMEU (cliente de implementación) ----------------
  add(
    'bartomeu',
    'CASO CLIENTE · Bartomeu — de 2.500€/mes a 300€',
    'Le costaba 2.500€ al mes tener a alguien agendando citas. Ahora paga 300€ y no falla ninguna. 📅\nEsto es lo que la IA le ahorra a UN solo negocio. Imagina el tuyo.\nTienes la clase gratuita para crear tu Agencia de IA en el enlace de la bio 🔗',
    HT('CasoCliente', 'CRM', 'Automatización', 'IAparaNegocios'),
    [
      cover({
        url: P.bartomeu,
        name: 'Bartomeu',
        label: 'Caso cliente',
        hook: 'Le costaba 2.500€/mes agendar citas. Ahora paga 300€.',
      }),
      content({
        kicker: 'Punto A',
        heading: 'Asesor fiscal, agenda a mano',
        body: 'Gestionaba manualmente todos sus recordatorios y citas, con riesgo constante de errores. La alternativa era contratar una secretaria: ~2.500€/mes con seguridad social.',
      }),
      content({
        kicker: 'La solución',
        heading: 'Un CRM que agenda, cobra y recuerda',
        body: 'Correo un día antes, correo una hora antes y WhatsApp 10 minutos antes. Sin que nadie toque nada.',
      }),
      content({ kicker: 'El resultado', big: 'x10', heading: 'Multiplicó por 10 su inversión el primer mes' }),
      content({
        kicker: 'La comparación',
        heading: '300€/mes vs 2.500€/mes',
        body: 'Mismo trabajo. Sin bajas, sin vacaciones, sin errores. Y funcionando también los domingos a las 3 de la mañana.',
      }),
      content({
        kicker: 'Quién lo montó',
        heading: 'Nuestra agencia de IA',
        body: 'Este es un cliente de implementación, no un alumno. Es exactamente el tipo de proyecto que nuestros alumnos aprenden a vender y entregar.',
      }),
      cta({ lead: 'Esto es lo que la IA le ahorra a un solo negocio. Imagina el tuyo.' }),
    ]
  )

  return T
}

// ---- inserción ----
const slide = (html) => ({ id: randomUUID(), html, notes: '', previousVersions: [] })

async function ensureBucket() {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (!data) await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '15MB' })
}

async function uploadPhotos(slugs) {
  const urls = {}
  for (const [slug, file] of Object.entries(PHOTO_FILES)) {
    if (slugs && !slugs.includes(slug)) continue
    const src = path.join(PHOTO_DIR, file)
    if (!fs.existsSync(src)) throw new Error(`No existe la foto: ${src}`)
    const key = `reference/casos-exito/${slug}.png`
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(key, fs.readFileSync(src), { contentType: 'image/png', upsert: true })
    if (error) throw new Error(`upload ${file}: ${error.message}`)
    urls[slug] = sb.storage.from(BUCKET).getPublicUrl(key).data.publicUrl
    console.log('· foto:', slug)
  }
  return urls
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const slugs = only.length ? only : null

  await ensureBucket()
  const photos = await uploadPhotos(slugs)

  let carousels = buildCarousels(photos)
  if (slugs) carousels = carousels.filter((c) => slugs.includes(c.slug))

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
