// Acceso a datos de testimonios / casos de éxito de [tenant] (solo servidor).
//
// Los usan: (a) el apartado de testimonios que consultan los closers en llamada y
// (b) el generador de guiones, que puede añadir prueba social al contenido.
//
// Tipos y helpers puros (compartidos con el cliente): lib/testimonios-shared.ts
// Tabla: public.testimonios (scripts/migration-v42-testimonios.sql)

import { createClient } from "@supabase/supabase-js"
import type { Testimonio, TestimonioKind, TestimonioPatch } from "./testimonios-shared"

export type { Testimonio, TestimonioKind, TestimonioPatch } from "./testimonios-shared"
export { youtubeId, youtubeThumb, testimonioPitch, testimonioForPrompt } from "./testimonios-shared"

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowTo(r: any): Testimonio {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    kind: (r.kind === "cliente" ? "cliente" : "alumno") as TestimonioKind,
    avatar: r.avatar ?? null,
    sector: r.sector ?? null,
    photoUrl: r.photo_url ?? null,
    youtubeUrl: r.youtube_url ?? null,
    hook: r.hook ?? null,
    puntoA: r.punto_a ?? null,
    puntoB: r.punto_b ?? null,
    vehiculo: r.vehiculo ?? null,
    cifra: r.cifra ?? null,
    hasRevenue: r.has_revenue !== false,
    consent: !!r.consent,
    sortOrder: typeof r.sort_order === "number" ? r.sort_order : 100,
    active: r.active !== false,
  }
}

export async function listTestimonios(includeInactive = false): Promise<Testimonio[]> {
  const sb = svc()
  let q = sb.from("testimonios").select("*").order("sort_order", { ascending: true })
  if (!includeInactive) q = q.eq("active", true)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowTo)
}

export async function getTestimonio(id: string): Promise<Testimonio | null> {
  const sb = svc()
  const { data, error } = await sb.from("testimonios").select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowTo(data) : null
}

/** Slug estable a partir del nombre, único dentro de la tabla. */
export async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "testimonio"
  const sb = svc()
  const { data } = await sb.from("testimonios").select("slug").like("slug", `${base}%`)
  const taken = new Set((data ?? []).map((r: { slug: string }) => r.slug))
  if (!taken.has(base)) return base
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`
  return `${base}-${Date.now()}`
}

export async function createTestimonio(
  input: Omit<TestimonioPatch, "sortOrder"> & { name: string }
): Promise<Testimonio> {
  const sb = svc()
  const slug = await uniqueSlug(input.name)
  // Los nuevos se colocan al final de la lista.
  const { data: last } = await sb
    .from("testimonios")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle()
  const sortOrder = ((last?.sort_order as number | undefined) ?? 100) + 10

  const { data, error } = await sb
    .from("testimonios")
    .insert({
      slug,
      name: input.name,
      kind: input.kind === "cliente" ? "cliente" : "alumno",
      avatar: input.avatar ?? null,
      sector: input.sector ?? null,
      photo_url: input.photoUrl ?? null,
      youtube_url: input.youtubeUrl ?? null,
      hook: input.hook ?? null,
      punto_a: input.puntoA ?? null,
      punto_b: input.puntoB ?? null,
      vehiculo: input.vehiculo ?? null,
      cifra: input.cifra ?? null,
      has_revenue: input.hasRevenue !== false,
      consent: input.consent === true,
      sort_order: sortOrder,
      active: input.active !== false,
    })
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return rowTo(data)
}

export async function deleteTestimonio(id: string): Promise<boolean> {
  const sb = svc()
  const { error } = await sb.from("testimonios").delete().eq("id", id)
  if (error) throw new Error(error.message)
  return true
}

export async function updateTestimonio(id: string, patch: TestimonioPatch): Promise<Testimonio | null> {
  const sb = svc()
  const p: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) p.name = patch.name
  if (patch.kind !== undefined) p.kind = patch.kind
  if (patch.avatar !== undefined) p.avatar = patch.avatar
  if (patch.sector !== undefined) p.sector = patch.sector
  if (patch.photoUrl !== undefined) p.photo_url = patch.photoUrl
  if (patch.youtubeUrl !== undefined) p.youtube_url = patch.youtubeUrl
  if (patch.hook !== undefined) p.hook = patch.hook
  if (patch.puntoA !== undefined) p.punto_a = patch.puntoA
  if (patch.puntoB !== undefined) p.punto_b = patch.puntoB
  if (patch.vehiculo !== undefined) p.vehiculo = patch.vehiculo
  if (patch.cifra !== undefined) p.cifra = patch.cifra
  if (patch.hasRevenue !== undefined) p.has_revenue = patch.hasRevenue
  if (patch.consent !== undefined) p.consent = patch.consent
  if (patch.sortOrder !== undefined) p.sort_order = patch.sortOrder
  if (patch.active !== undefined) p.active = patch.active
  const { data, error } = await sb.from("testimonios").update(p).eq("id", id).select("*").maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowTo(data) : null
}
