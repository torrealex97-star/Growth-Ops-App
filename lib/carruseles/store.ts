import { createClient } from "@supabase/supabase-js"
import type {
  CarruselProject,
  CarruselTemplate,
  BrandConfig,
  Slide,
  AspectRatio,
  ProjectKind,
  ReferenceImage,
} from "./types"
import { DEFAULT_BRAND, MAX_SLIDES, MAX_VERSIONS } from "./types"

function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function uid(): string {
  return (globalThis.crypto?.randomUUID?.() ??
    "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36))
}

function rowToProject(r: any): CarruselProject {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind as ProjectKind,
    aspectRatio: r.aspect_ratio as AspectRatio,
    slides: Array.isArray(r.slides) ? r.slides : [],
    referenceImages: Array.isArray(r.reference_images) ? r.reference_images : [],
    caption: r.caption ?? null,
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
    isTemplate: !!r.is_template,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

// ---------- Projects ----------

export async function listProjects(): Promise<CarruselProject[]> {
  const sb = svc()
  const { data, error } = await sb
    .from("carrusel_projects")
    .select("*")
    .eq("is_template", false)
    .order("updated_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToProject)
}

export async function getProject(id: string): Promise<CarruselProject | null> {
  const sb = svc()
  const { data, error } = await sb.from("carrusel_projects").select("*").eq("id", id).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowToProject(data) : null
}

export async function createProject(
  title: string,
  kind: ProjectKind,
  aspectRatio: AspectRatio,
  createdBy?: string | null
): Promise<CarruselProject> {
  const sb = svc()
  const { data, error } = await sb
    .from("carrusel_projects")
    .insert({ title, kind, aspect_ratio: aspectRatio, created_by: createdBy ?? null })
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return rowToProject(data)
}

export async function updateProject(
  id: string,
  updates: Partial<Pick<CarruselProject, "title" | "aspectRatio" | "kind" | "caption" | "hashtags">>
): Promise<CarruselProject | null> {
  const sb = svc()
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (updates.title !== undefined) patch.title = updates.title
  if (updates.aspectRatio !== undefined) patch.aspect_ratio = updates.aspectRatio
  if (updates.kind !== undefined) patch.kind = updates.kind
  if (updates.caption !== undefined) patch.caption = updates.caption
  if (updates.hashtags !== undefined) patch.hashtags = updates.hashtags
  const { data, error } = await sb.from("carrusel_projects").update(patch).eq("id", id).select("*").maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowToProject(data) : null
}

export async function deleteProject(id: string): Promise<boolean> {
  const sb = svc()
  const { error } = await sb.from("carrusel_projects").delete().eq("id", id)
  if (error) throw new Error(error.message)
  return true
}

export async function duplicateProject(id: string): Promise<CarruselProject | null> {
  const src = await getProject(id)
  if (!src) return null
  const sb = svc()
  const slides = src.slides.map((s) => ({ ...s, id: uid(), previousVersions: [] }))
  const { data, error } = await sb
    .from("carrusel_projects")
    .insert({
      title: `${src.title} (copia)`,
      kind: src.kind,
      aspect_ratio: src.aspectRatio,
      slides,
      reference_images: src.referenceImages,
      is_template: false,
    })
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return rowToProject(data)
}

// ---------- Slides (stored as jsonb array on the project) ----------

async function saveSlides(id: string, slides: Slide[]): Promise<CarruselProject | null> {
  const sb = svc()
  const { data, error } = await sb
    .from("carrusel_projects")
    .update({ slides, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data ? rowToProject(data) : null
}

export async function addSlide(projectId: string, html: string, notes = ""): Promise<Slide | null> {
  const project = await getProject(projectId)
  if (!project) return null
  if (project.slides.length >= MAX_SLIDES) return null
  const slide: Slide = { id: uid(), html, notes, previousVersions: [] }
  await saveSlides(projectId, [...project.slides, slide])
  return slide
}

export async function updateSlide(
  projectId: string,
  slideId: string,
  updates: Partial<Pick<Slide, "html" | "notes">>
): Promise<Slide | null> {
  const project = await getProject(projectId)
  if (!project) return null
  const slides = project.slides
  const idx = slides.findIndex((s) => s.id === slideId)
  if (idx === -1) return null
  const slide = { ...slides[idx] }
  if (updates.html !== undefined && updates.html !== slide.html) {
    slide.previousVersions = [...slide.previousVersions, slide.html].slice(-MAX_VERSIONS)
    slide.html = updates.html
  }
  if (updates.notes !== undefined) slide.notes = updates.notes
  slides[idx] = slide
  await saveSlides(projectId, slides)
  return slide
}

export async function deleteSlide(projectId: string, slideId: string): Promise<boolean> {
  const project = await getProject(projectId)
  if (!project) return false
  const slides = project.slides.filter((s) => s.id !== slideId)
  if (slides.length === project.slides.length) return false
  await saveSlides(projectId, slides)
  return true
}

export async function reorderSlides(projectId: string, slideIds: string[]): Promise<boolean> {
  const project = await getProject(projectId)
  if (!project) return false
  const map = new Map(project.slides.map((s) => [s.id, s]))
  const reordered: Slide[] = []
  for (const sid of slideIds) {
    const s = map.get(sid)
    if (!s) return false
    reordered.push(s)
  }
  if (reordered.length !== project.slides.length) return false
  await saveSlides(projectId, reordered)
  return true
}

export async function undoSlide(projectId: string, slideId: string): Promise<Slide | null> {
  const project = await getProject(projectId)
  if (!project) return null
  const slides = project.slides
  const idx = slides.findIndex((s) => s.id === slideId)
  if (idx === -1) return null
  const slide = { ...slides[idx] }
  if (slide.previousVersions.length === 0) return null
  const prev = [...slide.previousVersions]
  slide.html = prev.pop()!
  slide.previousVersions = prev
  slides[idx] = slide
  await saveSlides(projectId, slides)
  return slide
}

// ---------- Reference images ----------

export async function addReferenceImage(projectId: string, image: ReferenceImage): Promise<boolean> {
  const project = await getProject(projectId)
  if (!project) return false
  const sb = svc()
  const { error } = await sb
    .from("carrusel_projects")
    .update({ reference_images: [...project.referenceImages, image], updated_at: new Date().toISOString() })
    .eq("id", projectId)
  if (error) throw new Error(error.message)
  return true
}

export async function removeReferenceImage(projectId: string, imageId: string): Promise<boolean> {
  const project = await getProject(projectId)
  if (!project) return false
  const sb = svc()
  const { error } = await sb
    .from("carrusel_projects")
    .update({
      reference_images: project.referenceImages.filter((r) => r.id !== imageId),
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId)
  if (error) throw new Error(error.message)
  return true
}

// ---------- Brand (singleton) ----------

export async function getBrand(): Promise<BrandConfig> {
  const sb = svc()
  const { data, error } = await sb.from("carrusel_brand").select("*").eq("id", 1).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return DEFAULT_BRAND
  return {
    name: data.name ?? "",
    colors: { ...DEFAULT_BRAND.colors, ...(data.colors || {}) },
    fonts: { ...DEFAULT_BRAND.fonts, ...(data.fonts || {}) },
    logoUrl: data.logo_url ?? null,
    styleKeywords: Array.isArray(data.style_keywords) ? data.style_keywords : [],
  }
}

export async function updateBrand(updates: Partial<BrandConfig>): Promise<BrandConfig> {
  const current = await getBrand()
  const merged: BrandConfig = {
    ...current,
    ...updates,
    colors: { ...current.colors, ...(updates.colors || {}) },
    fonts: { ...current.fonts, ...(updates.fonts || {}) },
  }
  const sb = svc()
  const { error } = await sb.from("carrusel_brand").upsert({
    id: 1,
    name: merged.name,
    colors: merged.colors,
    fonts: merged.fonts,
    logo_url: merged.logoUrl,
    style_keywords: merged.styleKeywords,
    updated_at: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  return merged
}

// ---------- Templates ----------

export async function listTemplates(): Promise<CarruselTemplate[]> {
  const sb = svc()
  const { data, error } = await sb.from("carrusel_templates").select("*").order("created_at", { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    kind: r.kind as ProjectKind,
    aspectRatio: r.aspect_ratio as AspectRatio,
    slides: Array.isArray(r.slides) ? r.slides : [],
    createdAt: r.created_at,
  }))
}

export async function createTemplateFromProject(projectId: string): Promise<CarruselTemplate | null> {
  const project = await getProject(projectId)
  if (!project) return null
  const sb = svc()
  const slides = project.slides.map((s) => ({ ...s, id: uid(), previousVersions: [] }))
  const { data, error } = await sb
    .from("carrusel_templates")
    .insert({ title: project.title, kind: project.kind, aspect_ratio: project.aspectRatio, slides })
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return {
    id: data.id,
    title: data.title,
    kind: data.kind,
    aspectRatio: data.aspect_ratio,
    slides: data.slides,
    createdAt: data.created_at,
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const sb = svc()
  const { error } = await sb.from("carrusel_templates").delete().eq("id", id)
  if (error) throw new Error(error.message)
  return true
}

export async function createProjectFromTemplate(templateId: string): Promise<CarruselProject | null> {
  const sb = svc()
  const { data: tpl, error: terr } = await sb
    .from("carrusel_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle()
  if (terr) throw new Error(terr.message)
  if (!tpl) return null
  const slides = (Array.isArray(tpl.slides) ? tpl.slides : []).map((s: Slide) => ({
    ...s,
    id: uid(),
    previousVersions: [],
  }))
  const { data, error } = await sb
    .from("carrusel_projects")
    .insert({
      title: tpl.title,
      kind: tpl.kind,
      aspect_ratio: tpl.aspect_ratio,
      slides,
      is_template: false,
    })
    .select("*")
    .single()
  if (error) throw new Error(error.message)
  return rowToProject(data)
}
