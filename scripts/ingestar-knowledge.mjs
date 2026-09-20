// Ingesta RAG: parsea las skills canónicas (.agents/skills/*/SKILL.md), las trocea por módulo/sección,
// asigna la categoría RAG de docs/rag_*_knowledge_schema.json y siembra knowledge_chunks
// replicado en TODAS las subcuentas activas (conocimiento global de plataforma).
//
// Uso:
//   node scripts/ingestar-knowledge.mjs            # siembra
//   node scripts/ingestar-knowledge.mjs --dry-run  # solo muestra qué insertaría
//
// Idempotente: ON CONFLICT (tenant_id, source, section) DO UPDATE. Re-ejecutar tras editar una
// skill actualiza el contenido sin duplicar.
//
// EMBEDDINGS (migración 20260919230000): si hay GEMINI_API_KEY (entorno o .env.local), cada chunk
// se vectoriza con text-embedding-3-small (nativo 1536 dims = columna vector(1536)) y se guarda en
// la columna embedding — la RPC match_knowledge_chunks lo usa para la rama semántica de la búsqueda
// híbrida (RRF con la léxica). Sin clave, se siembra con embedding NULL y el sistema queda 100%
// léxico (degradación por diseño). Re-ingestar SIN clave NO borra embeddings existentes (COALESCE).
import { readFileSync } from 'node:fs'
import postgres from 'postgres'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const dryRun = process.argv.includes('--dry-run')
// El entorno gana sobre .env.local (patrón de scripts/env-local.mjs): permite apuntar la ingesta
// a otra base o, en hosts donde db.*.supabase.co es IPv6-only, a la URL del pooler IPv4
// (aws-<n>-<region>.pooler.supabase.com:6543, usuario postgres.<ref>).
const POSTGRES_URL = process.env.POSTGRES_URL || env.POSTGRES_URL
if (!POSTGRES_URL) {
  console.error('Falta POSTGRES_URL (entorno o .env.local)')
  process.exit(1)
}

// Categoría RAG por (fichero, módulo) — espejo de docs/rag_sales_knowledge_schema.json y
// docs/rag_marketing_knowledge_schema.json. Si se añade un módulo nuevo a una skill, añadirlo aquí:
// sin categoría el chunk se rechaza (fail-loud, no silencio).
const CATEGORIAS = {
  // Patrón único post-#85: las skills viven en .agents/skills/<nombre>/SKILL.md y
  // .claude/skills es solo symlinks. La ingesta lee la fuente REAL, no el symlink.
  '.agents/skills/sales-engineering/SKILL.md': {
    1: 'prospecting',
    2: 'pain_cycle',
    3: 'objection_handling',
    4: 'post_call',
    5: 'hiring',
    6: 'frame_control',
    7: 'kpis',
  },
  '.agents/skills/marketing-and-copywriting/SKILL.md': {
    1: 'uvp_and_angles',
    2: 'avatar_icp',
    3: 'funnel_architecture',
    4: 'copywriting_swipe',
    5: 'marketing_metrics',
    6: 'marketing_metrics', // módulo 6 (árboles de diagnóstico) va con métricas, según el schema
  },
}
const FUENTES = Object.keys(CATEGORIAS)

const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// Parseo: `## MÓDULO N: TÍTULO` abre módulo; `### Título` abre sección; todo hasta el siguiente
// header es el chunk. Si un módulo NO tiene secciones `###` (caso de la skill de ventas), el
// módulo COMPLETO es un chunk (section = modulo-N). Cualquier `## ` que no sea MÓDULO (apéndices,
// notas) cierra y desactiva el parseo: no es conocimiento de negocio.
function parsearSkill(path) {
  const texto = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const chunks = []
  let modulo = null
  let moduloTitulo = ''
  let seccion = null
  let buffer = []
  const cerrar = () => {
    if (modulo === null) return
    const content = buffer.join('\n').trim()
    if (content.length < 20) return // huecos vacíos entre headers: no son chunks
    const categoria = CATEGORIAS[path][modulo]
    if (!categoria) {
      console.error(`ERROR: módulo ${modulo} de ${path} sin categoría en CATEGORIAS — chunk rechazado`)
      process.exit(1)
    }
    const tituloSeccion = seccion ? seccion.titulo : 'Módulo completo'
    chunks.push({
      source: path,
      module: modulo,
      section: seccion ? slugify(`${modulo}-${tituloSeccion}`) : `modulo-${modulo}`,
      category: categoria,
      title: `${moduloTitulo} · ${tituloSeccion}`,
      content,
      metadata: { skill: path.includes('sales') ? 'sales' : 'marketing', language: 'es', type: 'framework' },
    })
  }
  for (const line of texto.split('\n')) {
    const mMod = line.match(/^## MÓDULO (\d+):\s*(.+)$/)
    const mSec = line.match(/^###\s+(.+)$/)
    const mOtro = /^## (?!MÓDULO)/.test(line)
    if (mMod) {
      cerrar()
      modulo = Number(mMod[1])
      moduloTitulo = `Módulo ${mMod[1]}: ${mMod[2].trim()}`
      seccion = null
      buffer = []
      continue
    }
    if (mOtro) {
      cerrar()
      modulo = null
      seccion = null
      buffer = []
      continue
    }
    if (mSec) {
      cerrar()
      seccion = { titulo: mSec[1].trim() }
      buffer = []
      continue
    }
    if (modulo !== null) buffer.push(line)
  }
  cerrar()
  return chunks
}

const chunks = FUENTES.flatMap(parsearSkill)
const porCategoria = {}
for (const c of chunks) porCategoria[c.category] = (porCategoria[c.category] || 0) + 1
console.log(`Parseados ${chunks.length} chunks:`)
for (const [cat, n] of Object.entries(porCategoria).sort()) console.log(`  ${cat}: ${n}`)

// ─── EMBEDDINGS ─────────────────────────────────────────────────────────────────
// El modelo DEBE coincidir con el de embedQuery (lib/ai/knowledge.ts): cambiar uno implica
// cambiar el otro y re-ingestar todo — mezclar espacios de embeddings rompe la semántica.
const GEMINI_KEY = process.env.GEMINI_API_KEY || env.GEMINI_API_KEY
const EMBED_MODEL = 'gemini-embedding-001'
const EMBED_DIMS = 1536

async function embeberLotes(textos, apiKey) {
  const out = []
  const BATCH = 64 // límite de requests por batchEmbedContents
  for (let i = 0; i < textos.length; i += BATCH) {
    const lote = textos.slice(i, i + BATCH).map((t) => t.slice(0, 6000)) // límite del modelo: 2048 tokens
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          requests: lote.map((t) => ({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text: t }] },
            taskType: 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EMBED_DIMS,
          })),
        }),
      }
    )
    if (!res.ok) throw new Error(`Gemini embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json()
    for (const d of json.embeddings ?? []) {
      if (!Array.isArray(d.values) || d.values.length !== EMBED_DIMS)
        throw new Error(`Embedding con dims inesperadas (${d.values?.length})`)
      out.push(`[${d.values.join(',')}]`)
    }
    console.log(`  embeddings ${Math.min(i + BATCH, textos.length)}/${textos.length}`)
  }
  return out
}

// prepare: false imprescindible tras poolers en modo transacción (PgBouncer); inofensivo en conexión directa.
const sql = postgres(POSTGRES_URL, { ssl: 'require', max: 1, prepare: false, idle_timeout: 20 })
try {
  const tenants = await sql`SELECT id FROM public.tenants WHERE status = 'active'`
  if (tenants.length === 0) {
    console.error('No hay subcuentas activas: nada que sembrar.')
    process.exit(1)
  }
  console.log(`Subcuentas activas: ${tenants.length}`)
  if (dryRun) {
    console.log('(dry-run: no se escribe nada)')
    process.exit(0)
  }
  // Vectorización: título+contenido (el título aporta señales de categoría/módulo al espacio).
  let mapaEmbeddings = null
  if (!GEMINI_KEY) {
    console.warn('Sin GEMINI_API_KEY (entorno o .env.local): se siembra SIN embeddings (solo búsqueda léxica).')
  } else {
    console.log(`Calculando embeddings (${chunks.length} chunks · ${EMBED_MODEL})...`)
    mapaEmbeddings = await embeberLotes(
      chunks.map((c) => `${c.title}\n${c.content}`),
      GEMINI_KEY
    )
  }
  const filas = tenants.flatMap((t) =>
    chunks.map((c, i) => ({
      tenant_id: t.id,
      ...c,
      is_active: true,
      embedding: mapaEmbeddings ? mapaEmbeddings[i] : null,
    }))
  )
  await sql`
    INSERT INTO public.knowledge_chunks ${sql(filas)}
    ON CONFLICT (tenant_id, source, section) DO UPDATE SET
      title      = EXCLUDED.title,
      category   = EXCLUDED.category,
      module     = EXCLUDED.module,
      content    = EXCLUDED.content,
      metadata   = EXCLUDED.metadata,
      -- COALESCE: re-ingesta sin clave NO debe borrar embeddings ya calculados.
      embedding  = COALESCE(EXCLUDED.embedding, knowledge_chunks.embedding),
      updated_at = NOW()
  `
  console.log(
    `Sembradas ${filas.length} filas (${chunks.length} chunks × ${tenants.length} tenants)${mapaEmbeddings ? ' con embeddings' : ' sin embeddings (sin clave)'}.`
  )
} catch (err) {
  console.error('Error de ingesta:', err.message)
  process.exit(1)
} finally {
  await sql.end()
}
