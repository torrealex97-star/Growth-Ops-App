import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { createProject, addSlide, updateProject, addReferenceImage } from "@/lib/carruseles/store"
import {
  buildCasoExitoSlides,
  buildCaption,
  normalizeCasoTitle,
  MAX_CONTENT_SLIDES,
  type CasoExitoSpec,
} from "@/lib/carruseles/caso-exito"
import { ensureConfig } from "@/lib/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const MODEL = "claude-sonnet-5"

const SYSTEM = `Eres el copywriter de IA WINNERS, una academia que enseña a montar agencias de inteligencia artificial. Escribes carruseles de Instagram de CASOS DE ÉXITO de alumnos, en español de España, con tono directo, cercano y sin humo.

Recibes el relato en bruto de un caso de éxito (notas, transcripción o resumen) y lo conviertes en la estructura del carrusel llamando SIEMPRE a la herramienta build_caso_exito.

ESTRUCTURA OBLIGATORIA de las slides de contenido (5 o 6 slides, en este orden):
1. PUNTO A — quién era y qué le dolía antes de entrar.
2. EL GIRO — qué descubrió, qué decisión tomó o cuál era su miedo real.
3. PUNTO B con la cifra ancla — usa el campo "big" con la cifra más fuerte (ej "12.000€", "23.000€", "11", "3 días"). El heading explica qué es esa cifra.
4. PUNTO B en detalle — qué vende, cómo funciona o qué ha cambiado en su vida.
5. EL VEHÍCULO — qué usó exactamente de la academia para conseguirlo.
6. (Opcional) Un matiz honesto, un aprendizaje o el siguiente reto.

REGLAS DE ORO:
- NUNCA inventes ni redondees cifras. Usa solo las que aparezcan en el relato. Si el relato NO tiene cifras económicas, no las inventes: usa una métrica de avance (tiempo, número de clientes, horas ahorradas) en el campo "big", o omite "big" en esa slide.
- Si el caso no tiene resultados económicos todavía (está en proceso), enfócalo como transformación de mentalidad o habilidad y dilo con honestidad. No lo disfraces de caso de facturación.
- Si el relato indica que es un CLIENTE de la agencia y no un alumno de la academia, pon label "Caso cliente" en lugar de "Caso de éxito".
- El "hook" es la frase más potente del caso: el contraste antes/después o la cifra. Máximo 90 caracteres.
- Los "heading" son cortos y contundentes (máximo 60 caracteres). El "body" desarrolla en 1-3 frases (máximo 320 caracteres).
- El "kicker" es una etiqueta de 1-4 palabras en mayúsculas conceptuales (ej "PUNTO A", "EL GIRO", "EL VEHÍCULO", "SU MIEDO REAL").
- El "ctaLead" es una frase gancho de cierre dirigida al lector (máximo 70 caracteres). No menciones el enlace ni la clase gratuita: eso ya lo pone la plantilla.
- El "caption" es el pie de Instagram: 2-4 líneas con emojis, sin hashtags dentro. No menciones el enlace de la bio: se añade automáticamente.
- No uses comillas dobles dentro de los textos; usa « » si necesitas citar.`

const TOOL: Anthropic.Tool = {
  name: "build_caso_exito",
  description: "Construye la estructura del carrusel de caso de éxito a partir del relato.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Título interno del carrusel, con el nombre y la cifra ancla." },
      name: { type: "string", description: "Nombre de la persona tal como debe salir en la portada." },
      label: {
        type: "string",
        enum: ["Caso de éxito", "Caso cliente"],
        description: "«Caso cliente» solo si es cliente de la agencia y no alumno de la academia.",
      },
      hook: { type: "string", description: "Frase gancho de la portada. Máx 90 caracteres." },
      slides: {
        type: "array",
        description: "5 o 6 slides de contenido en el orden de la estructura obligatoria.",
        minItems: 4,
        maxItems: MAX_CONTENT_SLIDES,
        items: {
          type: "object",
          properties: {
            kicker: { type: "string", description: "Etiqueta corta, 1-4 palabras." },
            heading: { type: "string", description: "Titular corto y contundente. Máx 60 caracteres." },
            body: { type: "string", description: "Desarrollo de 1-3 frases. Máx 320 caracteres." },
            big: { type: "string", description: "Cifra ancla a pantalla grande. Solo en la slide del resultado." },
          },
          required: ["heading"],
        },
      },
      ctaLead: { type: "string", description: "Frase gancho de cierre. Máx 70 caracteres." },
      caption: { type: "string", description: "Pie de Instagram de 2-4 líneas, sin hashtags." },
      hashtags: {
        type: "array",
        description: "5-6 hashtags sin la almohadilla.",
        items: { type: "string" },
      },
    },
    required: ["title", "name", "hook", "slides", "caption"],
  },
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function parseSpec(input: any, fallbackName: string): CasoExitoSpec | null {
  if (!input || typeof input !== "object") return null
  const slides = Array.isArray(input.slides)
    ? input.slides
        .filter((s: any) => s && typeof s.heading === "string" && s.heading.trim())
        .map((s: any) => ({
          kicker: typeof s.kicker === "string" ? s.kicker.trim() : undefined,
          heading: s.heading.trim(),
          body: typeof s.body === "string" && s.body.trim() ? s.body.trim() : undefined,
          big: typeof s.big === "string" && s.big.trim() ? s.big.trim() : undefined,
        }))
    : []
  if (!slides.length) return null
  const name = (typeof input.name === "string" && input.name.trim()) || fallbackName
  return {
    title: normalizeCasoTitle(typeof input.title === "string" ? input.title : "", name),
    name,
    label: input.label === "Caso cliente" ? "Caso cliente" : "Caso de éxito",
    hook: typeof input.hook === "string" && input.hook.trim() ? input.hook.trim() : `El caso de ${name}`,
    slides,
    ctaLead: typeof input.ctaLead === "string" && input.ctaLead.trim() ? input.ctaLead.trim() : undefined,
    caption: typeof input.caption === "string" ? input.caption : "",
    hashtags: Array.isArray(input.hashtags)
      ? input.hashtags.map((h: any) => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 8)
      : [],
  }
}

export async function POST(req: NextRequest) {
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  await ensureConfig().catch(() => {})
  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const name: string = typeof body.name === "string" ? body.name.trim() : ""
  const photoUrl: string = typeof body.photoUrl === "string" ? body.photoUrl.trim() : ""
  const story: string = typeof body.story === "string" ? body.story.trim() : ""

  if (!name) return NextResponse.json({ error: "Falta el nombre del alumno" }, { status: 400 })
  if (!photoUrl) return NextResponse.json({ error: "Falta la foto del caso de éxito" }, { status: 400 })
  if (story.length < 80)
    return NextResponse.json(
      { error: "Cuéntame algo más del caso (mínimo 80 caracteres) para poder montar el carrusel" },
      { status: 400 }
    )
  if (story.length > 60000) return NextResponse.json({ error: "El relato es demasiado largo" }, { status: 400 })

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let spec: CasoExitoSpec | null = null
  try {
    const res = await client.messages.create({
      model: MODEL as any,
      max_tokens: 4000,
      // Igual que en /chat: este flujo no usa thinking y los bloques vacíos rompen la request.
      thinking: { type: "disabled" },
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "build_caso_exito" },
      messages: [
        {
          role: "user",
          content: `Nombre del protagonista: ${name}\n\nRelato del caso de éxito:\n\n${story}`,
        },
      ],
    } as any)
    const use = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "build_caso_exito"
    )
    spec = parseSpec(use?.input, name)
  } catch (e) {
    const err = e as any
    const msg = err?.error?.error?.message || err?.error?.message || err?.message || "Error de la API"
    console.error("[carruseles/caso-exito] error:", err?.error ?? err)
    return NextResponse.json({ error: `No se pudo generar el carrusel: ${msg}` }, { status: 502 })
  }

  if (!spec)
    return NextResponse.json(
      { error: "El modelo no devolvió una estructura válida. Prueba a dar más detalle del caso." },
      { status: 502 }
    )

  const project = await createProject(spec.title, "carousel", "4:5", user.id)

  // La foto queda también como imagen de referencia para poder seguir editando por chat.
  await addReferenceImage(project.id, {
    id: crypto.randomUUID(),
    url: photoUrl,
    name: `${spec.name} (caso de éxito)`,
    addedAt: new Date().toISOString(),
  })

  const html = buildCasoExitoSlides(spec, photoUrl)
  for (const [i, h] of html.entries()) {
    const notes =
      i === 0 ? "Portada con foto" : i === html.length - 1 ? "CTA · clase gratuita" : `Contenido ${i}`
    await addSlide(project.id, h, notes)
  }

  await updateProject(project.id, {
    caption: buildCaption(spec.caption),
    hashtags: spec.hashtags?.length ? spec.hashtags : ["IAWinners", "AgenciaDeIA", "CasoDeExito"],
  })

  return NextResponse.json({ id: project.id, title: spec.title, slides: html.length })
}
