import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

// ---------------------------------------------------------------------------------------------
// EL INDICADOR DE RAMA DEL INSPECTOR RAG. Sin él, una clave de embeddings caducada pasaba
// inadvertida: la búsqueda seguía devolviendo resultados (solo léxicos) de peor calidad por
// significado y nadie se enteraba. El inspector muestra SIEMPRE qué rama alimentó el ranking.
// ---------------------------------------------------------------------------------------------

test('searchKnowledge informa el modo: híbrida cuando hubo embedding, léxica en la degradación', () => {
  const src = read('lib/ai/knowledge.ts')
  assert.match(src, /modo: 'hibrida' \| 'lexica'/)
  assert.match(src, /modo: pEmbedding \? 'hibrida' : 'lexica'/)
})

test('el endpoint expone modo en la respuesta para la UI', () => {
  const src = read('app/api/[tenant]/evergreen/ai/knowledge/route.ts')
  assert.match(src, /chunks: r\.chunks, modo: r\.modo/)
})

test('el inspector muestra el indicador con ambos estados y su explicación', () => {
  const src = read('app/[tenant]/settings/ai-knowledge/page.tsx')
  // Consulta al mismo endpoint que consume el agente (misma RPC en servidor).
  assert.match(src, /\/api\/\$\{tenant\}\/evergreen\/ai\/knowledge/)
  // Los dos estados del indicador, con la causa de la degradación visible.
  assert.match(src, /Sem[áa]ntica \+ l[ée]xica/)
  assert.match(src, /Solo l[ée]xica/)
  assert.match(src, /GEMINI_API_KEY/)
  // Filtro por categoría y visor de chunks con su fuente.
  assert.match(src, /CATEGORIAS/)
  assert.match(src, /c\.source/)
})

test('el inspector está registrado en la nav para admin/director', () => {
  const src = read('lib/nav.ts')
  assert.match(src, /label: 'Conocimiento IA'/)
  assert.match(src, /href: '\/settings\/ai-knowledge'/)
  // Rango de acceso alineado con la RLS de knowledge_chunks (solo administración).
  assert.match(src, /icon: Bot,\n\s*roles: \['admin', 'director'\]/)
})

// ---------------------------------------------------------------------------------------------
// FILTRO POR TIPO DE CONTENIDO (metadata.type): script | formula | framework | sequence |
// checklist — enum canónico de docs/rag_*_knowledge_schema.json. La cadena completa:
// RPC (p_types) → searchKnowledge → tool del agente + endpoint → inspector.
// ---------------------------------------------------------------------------------------------

test('la RPC filtra por p_types y conserva la firma de 5 args como envoltorio', () => {
  const src = read('supabase/migrations/20260920120000_knowledge_types_filter.sql')
  assert.match(src, /p_types\s+TEXT\[\] DEFAULT NULL/)
  assert.match(src, /k\.metadata->>'type' = ANY \(p_types\)/)
  // Compatibilidad: los callers de 5 args (y el schema cache de PostgREST) no se rompen.
  assert.match(
    src,
    /SELECT \* FROM public\.match_knowledge_chunks\(p_query, p_tenant, p_categories, p_limit, p_embedding, NULL\)/
  )
  // Grants explícitos de la firma nueva (sin ellos, EXECUTE denegado para authenticated).
  assert.match(
    src,
    /GRANT EXECUTE ON FUNCTION public\.match_knowledge_chunks\(TEXT, UUID, TEXT\[\], INTEGER, VECTOR\(1536\), TEXT\[\]\) TO authenticated/
  )
})

test('searchKnowledge acepta el filtro types y lo pasa a la RPC como p_types', () => {
  const src = read('lib/ai/knowledge.ts')
  assert.match(src, /export type KnowledgeType = 'script' \| 'formula' \| 'framework' \| 'sequence' \| 'checklist'/)
  assert.match(src, /types\?: KnowledgeType\[\]/)
  assert.match(src, /p_types: opts\?\.types \?\? null/)
  // El contexto del system prompt muestra el tipo de cada fragmento.
  assert.match(src, /c\.metadata\?\.type/)
})

test('la tool del agente y su schema exponen el filtro de tipos', () => {
  const tool = read('lib/ai/agent/tools.ts')
  assert.match(tool, /types\?: KnowledgeType\[\]/)
  assert.match(tool, /types,/) // llega a buscarKnowledgeChunks junto a categories/limit
  const gw = read('lib/ai/agent/gateway.ts')
  assert.match(gw, /enum: \['script', 'formula', 'framework', 'sequence', 'checklist'\]/)
  assert.match(gw, /input\.types as tools\.KnowledgeType\[\] \| undefined/)
})

test('el endpoint valida types contra el enum y el inspector filtra y muestra el badge', () => {
  const route = read('app/api/[tenant]/evergreen/ai/knowledge/route.ts')
  assert.match(route, /TIPOS_VALIDOS/)
  assert.match(route, /types: types\.length \? types : undefined/)
  const ui = read('app/[tenant]/settings/ai-knowledge/page.tsx')
  assert.match(ui, /params\.set\('types', tipo\)/)
  assert.match(ui, /ETIQUETA_TIPO/)
  assert.match(ui, /c\.metadata\?\.tags/)
})

test('la ingesta asigna type y tags de rol a cada chunk', () => {
  const src = read('scripts/ingestar-knowledge.mjs')
  assert.match(src, /TIPO_POR_CATEGORIA/)
  assert.match(src, /kpis: 'formula'/)
  assert.match(src, /objection_handling: 'script'/)
  assert.match(src, /TAGS_POR_CATEGORIA/)
  assert.match(src, /EXCEPCIONES_TIPO/)
  assert.match(src, /type: tipo,/)
})
