// Siembra la tabla public.testimonios con los 18 casos de éxito documentados.
// Re-ejecutable: hace upsert por slug, así que NO pisa los youtube_url ni los flags
// de consentimiento que ya hayas rellenado desde la app (solo rellena los vacíos).
//
// Requiere: scripts/migration-v42-testimonios.sql aplicada.
// Uso: node scripts/seed-testimonios.mjs

import { createClient } from "@supabase/supabase-js"
import fs from "node:fs"
import path from "node:path"

const envTxt = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
const env = {}
for (const line of envTxt.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim()
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

// Las fotos ya están en el bucket público (las subió gen-carruseles-testimonios.mjs).
const BUCKET = "carrusel-uploads"
const photo = (slug) =>
  sb.storage.from(BUCKET).getPublicUrl(`reference/casos-exito/${slug}.png`).data.publicUrl

// youtube_url se deja vacío salvo los que ya conocemos: se rellenan desde la app.
const T = [
  {
    slug: "xavi", name: "Xavi", kind: "alumno", avatar: "Emprendedor / trabajador quemado",
    sector: "Contenido y captación (infoproductores)",
    hook: "9 meses dudando. 30 días después, 12.000€ facturados.",
    punto_a: "Venía del sector de la noche. Escéptico con la IA y 9 meses dudando antes de entrar.",
    punto_b: "Agencia de IA propia ennichada en creación de contenido, avatares y captación automática. Libertad total de horario.",
    vehiculo: "El sistema de IA Winners aplicado a un nicho concreto: contenido + captación automatizada.",
    cifra: "12.000€ en su primer mes fuerte; después 3.000-4.000€/mes recurrentes con picos de 8.000€",
    has_revenue: true, sort_order: 10,
  },
  {
    slug: "rocio", name: "Rocío", kind: "alumno", avatar: "Agencia de marketing",
    sector: "Marketing",
    hook: "Ya trabajaba en marketing. Le faltaba venderlo con IA.",
    punto_a: "Trabajaba en marketing pero enterrada en tareas operativas sin valor.",
    punto_b: "Agencia de IA + marketing a pleno rendimiento, con dos clientes cerrados (uno simple y uno integral con CRM y funnels).",
    vehiculo: "La parte de mindset y acompañamiento de la comunidad más el sistema comercial de la academia.",
    cifra: "6.500€ en ticket combinado de sus dos primeros clientes",
    has_revenue: true, sort_order: 20,
  },
  {
    slug: "maxi", name: "Maxi", kind: "alumno", avatar: "Empresario / trabajador quemado",
    sector: "Inmobiliaria",
    hook: "De llamadas frías a 23.000€ en 30 días, sin pisar la calle.",
    punto_a: "Sector inmobiliario muy físico: llamadas frías y tú a tú. Cansado y desmotivado porque el negocio no crecía.",
    punto_b: "Inmobiliaria 100% online apalancada en IA que capta y filtra propietarios interesados en vender. Él solo cierra.",
    vehiculo: "Sistema de captación + calificación automática de leads aplicado a su propio sector.",
    cifra: "23.000€ netos en los últimos 30 días",
    has_revenue: true, sort_order: 30,
  },
  {
    slug: "claudia", name: "Claudia", kind: "alumno", avatar: "Perfil comercial / marketing digital",
    sector: "Marketing digital",
    hook: "Mes y medio dentro. Primer cliente cerrado.",
    punto_a: "Venía del marketing digital tradicional y buscaba un cambio de rumbo.",
    punto_b: "Primer cliente cerrado en mes y medio y varias propuestas en curso con nuevas empresas.",
    vehiculo: "El cambio de mentalidad más la estructura comercial de cómo cerrar y gestionar clientes.",
    cifra: "1 cliente cerrado y propuestas activas en 45 días",
    has_revenue: true, sort_order: 40,
  },
  {
    slug: "joseluis", name: "José Luis", kind: "alumno", avatar: "Empresario / consultor con experiencia",
    sector: "Eventos y conciertos (Ecuador)",
    hook: "16 años corporativos. Hoy hace IA para conciertos internacionales.",
    punto_a: "16 años de carrera corporativa (gerente de producto y gerente país). Emprendió como consultor pero sin diferenciación real.",
    punto_b: "Diseña y ejecuta estrategias de marketing con IA para eventos masivos y giras internacionales. Libertad total de tiempo para su familia.",
    vehiculo: "Formación de automatizaciones primero y escalado al programa completo tras validar resultados. 15 meses en el ecosistema.",
    cifra: "Vendió su primera automatización al 4º día; inversión del programa completo recuperada en 1 mes",
    has_revenue: true, sort_order: 50,
  },
  {
    slug: "adexe", name: "Adexe", kind: "alumno", avatar: "Técnico autodidacta / empresario",
    sector: "Agencia + Airbnb (Londres)",
    hook: "0 seguidores en Instagram. Clientes cerrados igual.",
    punto_a: "Llevaba tiempo investigando IA por su cuenta sin que ninguna formación le aportara nada nuevo.",
    punto_b: "Montó su agencia, aplicó lo aprendido a su propio negocio de Airbnb y captó clientes por red de contactos sin marca personal.",
    vehiculo: "Master Intensivo devorado en días, escalado al programa completo y apoyo fuerte en la comunidad.",
    cifra: "Primeros clientes cerrados antes de tener una sola publicación en redes",
    has_revenue: true, sort_order: 60,
  },
  {
    slug: "bernard", name: "Bernard", kind: "alumno", avatar: "Agencia de marketing",
    sector: "Agencia de publicidad y formación",
    hook: "2 semanas dentro. Ya liberó 2 horas diarias de su equipo.",
    punto_a: "Agencia de marketing y escuela de publicidad con 5 años, con mucho trabajo manual y miedo a quedarse atrás.",
    punto_b: "Con una sola automatización liberó 2 horas diarias a un empleado clave. Aplicando IA a su captación de Meta Ads.",
    vehiculo: "Automatización de procesos internos de su propia agencia con apenas 2 semanas en la academia.",
    cifra: "2 horas/día liberadas por persona con una sola automatización, en 2 semanas",
    has_revenue: false, sort_order: 70,
  },
  {
    slug: "mark", name: "Mark", kind: "alumno", avatar: "Perfil comercial / consultor digital",
    sector: "Negocios digitales e infoproductos",
    hook: "3 días dentro. Primera venta cerrada. Inversión recuperada.",
    punto_a: "Ya hacía embudos e infoproductos para clientes, pero sin la capa de IA y con clientes que no podían contratar más personal.",
    punto_b: "Primera venta a los 3 días y más reuniones agendadas, incluida una para desarrollo de una aplicación.",
    vehiculo: "Fue directo al módulo de servicios paquetizados y precios, apoyándose en el equipo técnico de la comunidad.",
    cifra: "Inversión recuperada en 3 días con una sola conversación comercial",
    has_revenue: true, sort_order: 80,
  },
  {
    slug: "miguel", name: "Miguel", kind: "alumno", avatar: "Trabajador quemado (sector financiero)",
    sector: "Inmobiliaria",
    hook: "11 clientes recurrentes. De empleado de fintech a dueño de agencia de IA.",
    punto_a: "Empleado en una fintech con un trabajo metódico que le aburría, sin saber nada de tecnología y saltando de vídeo en vídeo sin resultados.",
    punto_b: "Vive de su agencia de IA ennichada en inmobiliaria, con 11 clientes recurrentes y facturación estable. Superó su miedo a vender.",
    vehiculo: "Master Intensivo y luego el programa completo, siguiendo la metodología paso a paso sin saltarse ninguno. Empaquetó 3 servicios para inmobiliaria.",
    cifra: "11 clientes recurrentes · servicio estrella 2.000€ + 497€/mes · ~5.000€/mes recurrentes",
    has_revenue: true, sort_order: 90,
  },
  {
    slug: "maria", name: "María", kind: "alumno", avatar: "Trabajador quemado (perfil no técnico)",
    sector: "Docencia → agencia de IA",
    hook: "No sabía ni usar ChatGPT. 4 meses después: N8N, Make y Claude Code.",
    punto_a: "Maestra Montessori de 29 años, partía de cero absoluto: no usaba ni ChatGPT. Su miedo no era la academia, era «¿seré yo capaz?».",
    punto_b: "Entiende la lógica de automatizar y ha avanzado en Make, Go High Level, N8N y Claude Code. Roto el mito de que hace falta programar.",
    vehiculo: "Master Intensivo como puerta de entrada (completado en 6 días) y escalado al programa completo. La guía paso a paso y la comunidad.",
    cifra: "25% del IA Expert en 4 meses · Master Intensivo en 6 días",
    has_revenue: false, sort_order: 100,
  },
  {
    slug: "alberto", name: "Alberto", kind: "alumno", avatar: "Empresario que automatiza su negocio",
    sector: "Empresa propia (administración y energía)",
    hook: "5-6 horas al día metiendo datos. Hoy: 1 hora, y solo en lo que le gusta.",
    punto_a: "Empresario con programación obsoleta de hace 30 años, metiendo facturas y 24 datos diarios del precio de la luz a mano, con errores frecuentes.",
    punto_b: "Automatizó toda la parte administrativa: facturas, cobros bancarios, recibos, seguimiento del precio de la luz y un agente que gestiona su WhatsApp. Trabaja ~1 hora al día.",
    vehiculo: "Aprendió N8N sin programar dentro de la academia, empezando por una automatización sencilla y escalando a un ecosistema de agentes.",
    cifra: "De 5-6h/día a ~1h/día · coste del sistema ~50€/mes (valorado en 3.000-4.000€ si lo hiciera un tercero)",
    has_revenue: false, sort_order: 110,
  },
  {
    slug: "blanca", name: "Blanca", kind: "alumno", avatar: "Agencia de marketing / perfil comercial",
    sector: "Publicidad y marketing",
    hook: "Comparó varias academias por miedo a equivocarse.",
    punto_a: "Trabajadora fija en agencias de publicidad. Su miedo era elegir la academia incorrecta y arrepentirse.",
    punto_b: "Primer chatbot creado, automatizaciones de contenido y de agendamiento, y claridad sobre cómo paquetizar y poner precio.",
    vehiculo: "La estructura del contenido, la comunidad y las clases y GPTs de la academia para la parte comercial.",
    cifra: "Primer chatbot funcional y sistema de precios definido en 4 meses partiendo de cero",
    has_revenue: false, sort_order: 120,
  },
  {
    slug: "isabel", name: "Isabel Soler", kind: "alumno", avatar: "Trabajador quemado (funcionaria)",
    sector: "Gestión de inmuebles / marketing",
    hook: "25 años de funcionaria. Un año de agencia de IA. Mismo sueldo, cero techo.",
    punto_a: "25 años como funcionaria con 2.500€ y 18 años más de la misma proyección. Vendía funnels como freelance pero con «caos y desorden».",
    punto_b: "Transicionó su agencia hacia servicios de IA. Igualó y superó su sueldo de funcionaria en un año, con libertad total de horario.",
    vehiculo: "Sobre todo la parte comercial: cómo paquetizar servicios de IA y vender una realidad, más la comunidad para mantenerse actualizada.",
    cifra: "2.500€/mes recurrentes igualados en el primer año · caso cliente: 50-60 emails/día automatizados en 107 apartamentos",
    has_revenue: true, sort_order: 130,
  },
  {
    slug: "jesus", name: "Jesús", kind: "alumno", avatar: "Trabajador quemado (hostelería)",
    sector: "Fisioterapia, dental y extraescolares",
    hook: "De poner cachimbas en discotecas a 6 clientes de IA.",
    punto_a: "Recorrido 100% de hostelería y temporadas. Nivel de partida en IA de 2-3 sobre 10 y sin experiencia construyendo automatizaciones.",
    punto_b: "Agencia montada con un equipo de 4 (2 desarrolladores y 2 closers), con 6 clientes captados y 4 casi cerrados en 5 meses.",
    vehiculo: "Entró por recomendación boca a boca. Destaca el GPT calculador de precios y las clases en directo para dudas técnicas concretas.",
    cifra: "6 clientes captados, 4 casi cerrados · ticket medio ~2.800€ de setup",
    has_revenue: true, sort_order: 140,
  },
  {
    slug: "carolina", name: "Carolina", kind: "alumno", avatar: "Empleada / madre → emprendedora",
    sector: "Salud y clínicas",
    hook: "Nunca fue emprendedora. Un mes después: 5 clientes y casi 10.000€.",
    punto_a: "Toda su carrera como empleada haciendo marketing para clínicas. Crecía a costa de no poder recoger a sus hijos del colegio.",
    punto_b: "Agencia con su marido y su antigua jefa especializada en salud, con recepcionista de IA y CRM sobre Go High Level. 5 clientes en un mes.",
    vehiculo: "Master Intensivo en su baja de maternidad y escalado al IA Expert. Destaca el módulo de paquetización y pricing y el de Go High Level.",
    cifra: "5 clientes en 1 mes de actividad comercial · cerca de 10.000€ facturados · CRM 1.500€ + 350€/mes",
    has_revenue: true, sort_order: 150,
  },
  {
    slug: "stefano", name: "Stefano", kind: "alumno", avatar: "Técnico / desarrollador",
    sector: "Automatizaciones (nómada)",
    hook: "Un año sin encontrar trabajo de programador. Hoy vive y trabaja desde su autocaravana.",
    punto_a: "Desarrollador de apps móviles freelance, casi un año sin encontrar trabajo estable y pensando siempre en euros por hora.",
    punto_b: "Agencia de IA propia, automatizaciones avanzadas con N8N y Claude Code, y vida a tiempo completo en la autocaravana que construyó él mismo.",
    vehiculo: "Master Intensivo y IA Expert usados «just-in-time»: busca la lección concreta justo antes de necesitarla. El módulo de venta por valor.",
    cifra: "Primer cliente en 1 día de desarrollo (100€, él mismo reconoce que valía mucho más)",
    has_revenue: false, sort_order: 160,
  },
  {
    slug: "mariapaz", name: "María Paz", kind: "alumno", avatar: "Gerente de IT → emprendedora",
    sector: "IT / automatizaciones",
    youtube_url: "https://www.youtube.com/watch?v=gA3wGG0vPiQ",
    hook: "No sabía qué era Make ni N8N. Hoy desarrolla sus propias soluciones de IA.",
    punto_a: "Gerente de IT con años de experiencia, harta de ser empleada y con valores desalineados con la compañía. Su miedo real era estar sola.",
    punto_b: "Desarrolla sus propias soluciones, colabora con más de 8 comerciales y ya entra en reuniones con clientes a presentar demos. Todavía sin cerrar la primera venta.",
    vehiculo: "Eligió el perfil técnico y se apalanca en los comerciales de la comunidad. Destaca el networking y las clases en directo.",
    cifra: "Más de 8 comerciales con los que colabora · 4 meses en la academia",
    has_revenue: false, sort_order: 170,
  },
  {
    slug: "bartomeu", name: "Bartomeu", kind: "cliente", avatar: "Empresario (cliente de implementación)",
    sector: "Asesoría fiscal",
    hook: "Le costaba 2.500€/mes agendar citas. Ahora paga 300€.",
    punto_a: "Asesor fiscal autónomo gestionando a mano sus recordatorios y agenda, con el coste alternativo de una secretaria (~2.500€/mes).",
    punto_b: "CRM automatizado que agenda, cobra y gestiona citas y recordatorios (email un día antes, una hora antes y WhatsApp 10 minutos antes).",
    vehiculo: "Implementación de agente y CRM de IA por nuestra agencia. NO es alumno de la academia.",
    cifra: "Multiplicó por 10 su inversión el primer mes · ~200-300€/mes frente a ~2.500€/mes de una secretaria",
    has_revenue: true, sort_order: 180,
  },
]

async function main() {
  for (const t of T) {
    const { data: existing } = await sb
      .from("testimonios")
      .select("id, youtube_url, consent, photo_url")
      .eq("slug", t.slug)
      .maybeSingle()

    const row = {
      ...t,
      photo_url: existing?.photo_url || photo(t.slug),
      // No pisar lo que ya se haya rellenado desde la app.
      youtube_url: existing?.youtube_url || t.youtube_url || null,
      consent: existing?.consent ?? false,
      updated_at: new Date().toISOString(),
    }

    const { error } = await sb.from("testimonios").upsert(row, { onConflict: "slug" })
    if (error) throw new Error(`${t.slug}: ${error.message}`)
    console.log(`${existing ? "↻" : "+"} ${t.name}${row.youtube_url ? " (con vídeo)" : ""}`)
  }
  const faltan = T.filter((t) => !t.youtube_url).length
  console.log(`\nListo: ${T.length} testimonios. Sin enlace de YouTube: ${faltan}.`)
}

main().catch((e) => {
  console.error("ERROR:", e.message)
  process.exit(1)
})
