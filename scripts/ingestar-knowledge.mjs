// Ingesta RAG: parsea las skills canónicas (.claude/skills/*.md), las trocea por módulo/sección,
// asigna la categoría RAG de docs/rag_*_knowledge_schema.json y siembra knowledge_chunks
// replicado en TODAS las subcuentas activas (conocimiento global de plataforma).
//
// Uso:
//   node scripts/ingestar-knowledge.mjs            # siembra
//   node scripts/ingestar-knowledge.mjs --dry-run  # solo muestra qué insertaría
//
// Idempotente: ON CONFLICT (tenant_id, source, section) DO UPDATE. Re-ejecutar tras editar una
// skill actualiza el contenido sin duplicar. Embeddings: la columna vector(1536) queda NULL hasta
// que exista pipeline de embeddings; la búsqueda léxica (match_knowledge_chunks) funciona sin ella.
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
  '.claude/skills/sales-engineering.md': {
    1: 'prospecting',
    2: 'pain_cycle',
    3: 'objection_handling',
    4: 'post_call',
    5: 'hiring',
    6: 'frame_control',
    7: 'kpis',
  },
  '.claude/skills/marketing-and-copywriting.md': {
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
  const filas = tenants.flatMap((t) => chunks.map((c) => ({ tenant_id: t.id, ...c, is_active: true })))
  await sql`
    INSERT INTO public.knowledge_chunks ${sql(filas)}
    ON CONFLICT (tenant_id, source, section) DO UPDATE SET
      title      = EXCLUDED.title,
      category   = EXCLUDED.category,
      module     = EXCLUDED.module,
      content    = EXCLUDED.content,
      metadata   = EXCLUDED.metadata,
      updated_at = NOW()
  `
  console.log(`Sembradas ${filas.length} filas (${chunks.length} chunks × ${tenants.length} tenants).`)
} catch (err) {
  console.error('Error de ingesta:', err.message)
  process.exit(1)
} finally {
  await sql.end()
}
