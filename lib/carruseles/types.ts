// Tipos del módulo Carruseles & Flyers (portado de open-carrusel, adaptado a Supabase).

export type AspectRatio = "1:1" | "4:5" | "9:16" | "3:4" | "A4"
export type ProjectKind = "carousel" | "flyer"

export interface Slide {
  id: string
  html: string
  notes: string
  previousVersions: string[]
}

export interface ReferenceImage {
  id: string
  url: string // URL pública (Supabase Storage)
  name: string
  addedAt: string
}

export interface CarruselProject {
  id: string
  title: string
  kind: ProjectKind
  aspectRatio: AspectRatio
  slides: Slide[]
  referenceImages: ReferenceImage[]
  caption: string | null
  hashtags: string[]
  isTemplate: boolean
  createdAt: string
  updatedAt: string
}

export interface CarruselTemplate {
  id: string
  title: string
  kind: ProjectKind
  aspectRatio: AspectRatio
  slides: Slide[]
  createdAt: string
}

export interface BrandColors {
  primary: string
  secondary: string
  accent: string
  background: string
  surface: string
}

export interface BrandFonts {
  heading: string
  body: string
}

export interface BrandConfig {
  name: string
  colors: BrandColors
  fonts: BrandFonts
  logoUrl: string | null
  styleKeywords: string[]
}

export const DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "3:4": { width: 1080, height: 1440 },
  A4: { width: 1240, height: 1754 },
}

export const ASPECT_LABELS: Record<AspectRatio, string> = {
  "1:1": "Cuadrado 1:1",
  "4:5": "Vertical 4:5",
  "9:16": "Story 9:16",
  "3:4": "Póster 3:4",
  A4: "Flyer A4",
}

export const MAX_SLIDES = 20
export const MAX_VERSIONS = 5

export const DEFAULT_BRAND: BrandConfig = {
  name: "",
  colors: {
    primary: "#0b1220",
    secondary: "#1e293b",
    accent: "#1e9eff",
    background: "#ffffff",
    surface: "#f5f7fb",
  },
  fonts: { heading: "Inter", body: "Inter" },
  logoUrl: null,
  styleKeywords: [],
}
