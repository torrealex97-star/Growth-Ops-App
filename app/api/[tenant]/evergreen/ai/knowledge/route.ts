import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { createClient } from '@/lib/supabase/server'
import { searchKnowledge, type KnowledgeCategory } from '@/lib/ai/knowledge'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'

// Búsqueda RAG del conocimiento canónico (skills de ventas y marketing) para las pantallas.
// El agente conversacional NO pasa por aquí: tiene su propia tool searchKnowledge (lib/ai/agent),
// que recibe el tenant ya resuelto. Este endpoint sirve a la UI (inspector de conocimiento,
// sugerencias contextuales) con el mismo cierre: requireTenant + cliente autenticado del usuario
// — la RLS de knowledge_chunks (solo admin/director/super_admin) es el backstop.
const CATEGORIAS_VALIDAS = new Set<KnowledgeCategory>([
  'objection_handling',
  'pain_cycle',
  'kpis',
  'frame_control',
  'hiring',
  'prospecting',
  'post_call',
  'uvp_and_angles',
  'avatar_icp',
  'funnel_architecture',
  'copywriting_swipe',
  'marketing_metrics',
])

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (!q) return NextResponse.json({ error: 'Falta el parámetro q' }, { status: 400 })
  if (q.length > 500)
    return NextResponse.json({ error: 'Consulta demasiado larga (máx. 500 caracteres)' }, { status: 400 })

  const categories = (req.nextUrl.searchParams.get('categories') || '')
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is KnowledgeCategory => CATEGORIAS_VALIDAS.has(c as KnowledgeCategory))

  const limitRaw = Number(req.nextUrl.searchParams.get('limit')) || 5
  const limit = Math.min(Math.max(limitRaw, 1), 20)

  const sb = await createClient()
  // Instantánea de config del tenant: GEMINI_API_KEY para la rama semántica (embeddings).
  // Sin clave configurada, searchKnowledge degrada sola a la rama léxica.
  const env = await getTenantConfigWithFallback(auth.tenantId)
  const r = await searchKnowledge(sb, auth.tenantId, q, {
    categories: categories.length ? categories : undefined,
    limit,
    embeddingEnv: env,
  })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 })
  // `modo` dice a la UI si la consulta usó la rama semántica o solo la léxica
  // (indicador visual del inspector: el admin debe saber de qué calidad es lo que ve).
  return NextResponse.json({ chunks: r.chunks, modo: r.modo })
}
