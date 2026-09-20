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
