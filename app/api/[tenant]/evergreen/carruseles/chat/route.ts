import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { getCarruselUser } from "@/lib/carruseles/auth"
import { requireTenant } from "@/lib/auth/requireTenant"
import { getBrand, getProject, addSlide, updateSlide, deleteSlide, updateProject } from "@/lib/carruseles/store"
import { buildSystemPrompt, type BrandAsset } from "@/lib/carruseles/system-prompt"
import { MAX_SLIDES } from "@/lib/carruseles/types"
import { ensureConfig } from "@/lib/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const MODEL = "claude-sonnet-5"
const MAX_ITERATIONS = 16
// Límite de "reintentos" internos cuando el modelo deja de llamar tools sin haber
// terminado el número de slides pedido. Acotado para no consumir todas las MAX_ITERATIONS
// ni entrar en bucle infinito si el modelo se niega a seguir.
const MAX_AUTO_CONTINUES = 3
// Cuántas imágenes de referencia (las más recientes) y assets de marca se adjuntan como
// bloques de imagen reales en la petición.
const MAX_REFERENCE_IMAGES = 4
const MAX_BRAND_ASSET_IMAGES = 3

const TOOLS: Anthropic.Tool[] = [
  {
    name: "add_slide",
    description:
      "Añade una slide nueva al final del proyecto. El html es HTML a nivel de body (sin <html>/<head>/<body>).",
    input_schema: {
      type: "object",
      properties: {
        html: { type: "string", description: "HTML completo de la slide (nivel body)" },
        notes: { type: "string", description: "Descripción corta de la slide" },
      },
      required: ["html"],
    },
  },
  {
    name: "update_slide",
    description: "Reemplaza el HTML de una slide existente por su id. Guarda la versión anterior para deshacer.",
    input_schema: {
      type: "object",
      properties: {
        slideId: { type: "string" },
        html: { type: "string" },
        notes: { type: "string" },
      },
      required: ["slideId", "html"],
    },
  },
  {
    name: "delete_slide",
    description: "Elimina una slide por su id.",
    input_schema: {
      type: "object",
      properties: { slideId: { type: "string" } },
      required: ["slideId"],
    },
  },
  {
    name: "set_caption",
    description: "Guarda el pie de foto (caption) y los hashtags de Instagram del proyecto.",
    input_schema: {
      type: "object",
      properties: {
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
      },
      required: ["caption"],
    },
  },
]

/* eslint-disable @typescript-eslint/no-explicit-any */
async function executeTool(projectId: string, name: string, input: any): Promise<string> {
  try {
    if (name === "add_slide") {
      const slide = await addSlide(projectId, String(input.html || ""), String(input.notes || ""))
      if (!slide) return `ERROR: no se pudo añadir la slide (límite ${MAX_SLIDES} alcanzado o proyecto inexistente).`
      return `OK: slide añadida con id ${slide.id}.`
    }
    if (name === "update_slide") {
      const slide = await updateSlide(projectId, String(input.slideId), {
        html: input.html !== undefined ? String(input.html) : undefined,
        notes: input.notes !== undefined ? String(input.notes) : undefined,
      })
      if (!slide) return `ERROR: no existe la slide ${input.slideId}.`
      return `OK: slide ${slide.id} actualizada.`
    }
    if (name === "delete_slide") {
      const ok = await deleteSlide(projectId, String(input.slideId))
      return ok ? `OK: slide ${input.slideId} eliminada.` : `ERROR: no existe la slide ${input.slideId}.`
    }
    if (name === "set_caption") {
      await updateProject(projectId, {
        caption: String(input.caption || ""),
        hashtags: Array.isArray(input.hashtags) ? input.hashtags.map(String) : [],
      })
      return `OK: caption y hashtags guardados.`
    }
    return `ERROR: herramienta desconocida ${name}.`
  } catch (e) {
    return `ERROR: ${(e as Error).message}`
  }
}

const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"]

interface FetchedImage {
  block: Anthropic.ImageBlockParam | null
  warning: string | null
}

// Descarga una imagen (referencia o asset de marca) y la convierte en un bloque de imagen
// para el mensaje del usuario. En vez de descartarla en silencio cuando falla, devuelve un
// aviso legible para poder informar al usuario (SVG no soportado por el modelo, >4MB, etc).
async function fetchImageBlock(url: string, name: string): Promise<FetchedImage> {
  try {
    const res = await fetch(url)
    if (!res.ok) return { block: null, warning: `No se pudo descargar "${name}" (${res.status}).` }
    const ct = res.headers.get("content-type") || ""
    if (ct.includes("svg")) {
      return { block: null, warning: `"${name}" es SVG: la IA no puede verlo como imagen (usa PNG/JPEG/WEBP para referencias visuales).` }
    }
    const media = SUPPORTED_IMAGE_TYPES.find((m) => ct.includes(m))
    if (!media) return { block: null, warning: `"${name}" tiene un formato no soportado (${ct || "desconocido"}).` }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 4 * 1024 * 1024) {
      return { block: null, warning: `"${name}" pesa más de 4MB: no se pudo adjuntar a la IA (redúcela de tamaño).` }
    }
    return {
      block: { type: "image", source: { type: "base64", media_type: media as any, data: buf.toString("base64") } },
      warning: null,
    }
  } catch (e) {
    return { block: null, warning: `Error al descargar "${name}": ${(e as Error).message}` }
  }
}

// Extrae, si el usuario lo indicó explícitamente, el número de slides solicitado
// (ej. "carrusel de 6 slides", "hazme 4 diapositivas"). Null si no hay número claro.
function extractRequestedSlideCount(message: string): number | null {
  const m = message.match(/(\d{1,2})\s*(slides?|diapositivas?|di?ap?os?itivas?|im[aá]genes?|p[aá]ginas?)/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0 || n > MAX_SLIDES) return null
  return n
}

function parseBrandAssets(raw: string | undefined): BrandAsset[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((a) => a && typeof a.url === "string")
      .map((a) => ({ url: a.url, name: typeof a.name === "string" ? a.name : "asset" }))
  } catch {
    return []
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ("error" in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  await ensureConfig(t.tenantId).catch(() => {})

  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 503 })

  const body = await req.json().catch(() => ({}))
  const message: string = typeof body.message === "string" ? body.message : ""
  const projectId: string = typeof body.projectId === "string" ? body.projectId : ""
  const history: Array<{ role: string; content: string }> = Array.isArray(body.history) ? body.history : []

  if (!message.trim() || message.length > 10000)
    return NextResponse.json({ error: "Mensaje inválido" }, { status: 400 })

  const project = await getProject(projectId)
  if (!project) return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 })

  const brand = await getBrand()
  const brandAssets = parseBrandAssets(process.env.IG_BRAND_ASSETS)
  const system = buildSystemPrompt(brand, project, process.env.IG_BUSINESS_CONTEXT, brandAssets)
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  // Construye el historial (solo texto) + mensaje actual con imágenes de referencia/marca.
  const messages: Anthropic.MessageParam[] = []
  for (const h of history.slice(-12)) {
    if ((h.role === "user" || h.role === "assistant") && typeof h.content === "string" && h.content.trim()) {
      messages.push({ role: h.role, content: h.content })
    }
  }

  const imageWarnings: string[] = []
  const userBlocks: Anthropic.ContentBlockParam[] = [{ type: "text", text: message }]

  // Las N referencias MÁS RECIENTES (no las primeras) para que una imagen recién subida
  // siempre se adjunte de verdad, aunque ya hubiera otras referencias antes.
  const recentRefs = project.referenceImages.slice(-MAX_REFERENCE_IMAGES)
  for (const ref of recentRefs) {
    const { block, warning } = await fetchImageBlock(ref.url, ref.name)
    if (block) userBlocks.push(block)
    if (warning) imageWarnings.push(warning)
  }

  const recentAssets = brandAssets.slice(0, MAX_BRAND_ASSET_IMAGES)
  for (const asset of recentAssets) {
    const { block, warning } = await fetchImageBlock(asset.url, asset.name)
    if (block) userBlocks.push(block)
    if (warning) imageWarnings.push(warning)
  }

  messages.push({ role: "user", content: userBlocks })

  // Número objetivo de slides si el usuario lo pidió explícitamente. Si el proyecto ya
  // tenía slides (edición/continuación), se interpreta como "añade N más"; si partía de
  // cero, se interpreta como el total del carrusel.
  const requested = extractRequestedSlideCount(message)
  const baselineCount = project.slides.length
  const targetSlideCount = requested != null ? baselineCount + requested : null

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
        } catch {
          /* closed */
        }
      }

      for (const w of imageWarnings) send({ type: "warning", warning: w })

      let autoContinues = 0

      try {
        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          let final: Anthropic.Message
          try {
            const ms = client.messages.stream({
              model: MODEL as any,
              max_tokens: 16000,
              // Sonnet 5 activa "adaptive thinking" por defecto y devuelve bloques
              // thinking con texto vacío (display "omitted"). Al reenviar esos bloques
              // en la siguiente vuelta del loop, la API responde 400
              // "each thinking block must contain thinking". Este generador no usa
              // thinking, así que lo desactivamos explícitamente.
              thinking: { type: "disabled" },
              system,
              tools: TOOLS,
              messages,
            } as any)
            ms.on("text", (t: string) => send({ type: "token", text: t }))
            final = await ms.finalMessage()
          } catch (apiErr) {
            throw enrichApiError(apiErr)
          }

          messages.push({ role: "assistant", content: final.content })

          const toolUses = final.content.filter(
            (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          )

          if (toolUses.length === 0) {
            // El modelo dejó de llamar tools. Si aún faltan slides respecto al número
            // pedido explícitamente, empújalo a continuar (acotado para no bucle infinito).
            if (targetSlideCount != null && autoContinues < MAX_AUTO_CONTINUES) {
              const current = await getProject(projectId)
              const currentCount = current?.slides.length ?? 0
              if (currentCount < targetSlideCount) {
                autoContinues++
                messages.push({
                  role: "user",
                  content: `Todavía te faltan slides: llevas ${currentCount} de ${targetSlideCount} pedidas. Continúa AHORA llamando a add_slide para las que faltan (la última debe ser el CTA). No expliques nada, solo usa las tools.`,
                })
                continue
              }
            }
            break
          }

          const results: Anthropic.ToolResultBlockParam[] = []
          for (const tu of toolUses) {
            const out = await executeTool(projectId, tu.name, tu.input)
            send({ type: "refresh" }) // el cliente refresca el proyecto tras cada cambio
            results.push({ type: "tool_result", tool_use_id: tu.id, content: out })
          }
          messages.push({ role: "user", content: results })
        }
        send({ type: "done" })
      } catch (e) {
        const { message: msg, detail } = describeError(e)
        console.error("[carruseles/chat] error:", detail)
        send({ type: "error", error: msg })
        send({ type: "done" })
      } finally {
        try {
          controller.close()
        } catch {
          /* closed */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

// Envuelve un error del SDK de Anthropic conservando el status/type/message reales
// (en vez de perderlos al convertir a Error genérico), para poder diagnosticarlo.
function enrichApiError(e: unknown): Error {
  const err = e as any
  const status = err?.status
  const apiType = err?.error?.error?.type || err?.error?.type
  const apiMessage = err?.error?.error?.message || err?.error?.message || err?.message
  const wrapped = new Error(apiMessage || "Error desconocido de la API de Anthropic")
  ;(wrapped as any).__anthropic = { status, apiType, apiMessage, raw: err?.error ?? err }
  return wrapped
}

// Construye un mensaje de error legible para el usuario y un detalle completo para logs,
// exponiendo el campo/type exacto que rechazó la API cuando está disponible.
function describeError(e: unknown): { message: string; detail: unknown } {
  const err = e as any
  const enriched = err?.__anthropic
  if (enriched) {
    const parts = [enriched.apiType, enriched.status ? `HTTP ${enriched.status}` : null, enriched.apiMessage]
      .filter(Boolean)
      .join(" · ")
    return { message: parts || "Error de la API de Anthropic", detail: enriched.raw }
  }
  const status = err?.status
  const apiType = err?.error?.error?.type || err?.error?.type || err?.type
  const apiMessage = err?.error?.error?.message || err?.error?.message || err?.message
  const parts = [apiType, status ? `HTTP ${status}` : null, apiMessage].filter(Boolean).join(" · ")
  return { message: parts || (err instanceof Error ? err.message : "Error inesperado"), detail: err?.error ?? err }
}
