import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getTestimonioUser } from "@/lib/testimonios-auth"

export const runtime = "nodejs"

// Comparte bucket con los carruseles: las fotos de los casos de éxito se usan en ambos sitios.
const BUCKET = "carrusel-uploads"
const ALLOWED = ["image/png", "image/jpeg", "image/webp"]
const MAX = 15 * 1024 * 1024

export async function POST(req: NextRequest) {
  const user = await getTestimonioUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  if (!user.canWrite) return NextResponse.json({ error: "Sin permiso para subir fotos" }, { status: 403 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "Form inválido" }, { status: 400 })
  const file = form.get("file")
  if (!(file instanceof File)) return NextResponse.json({ error: "file requerido" }, { status: 400 })
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "Formato no soportado" }, { status: 400 })
  if (file.size > MAX) return NextResponse.json({ error: "Máx 15MB" }, { status: 400 })

  const ext = file.name.split(".").pop()?.toLowerCase() || "png"
  const key = `testimonios/${crypto.randomUUID()}.${ext}`
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const { error } = await sb.storage.from(BUCKET).upload(key, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type,
    upsert: false,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ url: sb.storage.from(BUCKET).getPublicUrl(key).data.publicUrl })
}
