// ─────────────────────────────────────────────────────────────────────────────
// AUDITORÍA DE COLUMNAS FANTASMA (estática)
// ─────────────────────────────────────────────────────────────────────────────
// Cruza TODAS las queries PostgREST de la app (.from(...).select/eq/or/insert/
// update/upsert) contra el esquema VIVO expuesto por PostgREST y reporta las
// columnas que no existen. Nació del caso calendly_event_id (PR #86): una query
// con una columna inexistente devuelve HTTP 400 y la sección se quedaba vacía
// EN SILENCIO — tsc y la suite no lo pillaban porque los clientes de Supabase
// no estaban tipados.
//
// Clasificación:
//   · tier1 — la columna no existe en NINGUNA tabla → 400 garantizado (bug seguro).
//   · tier2 — existe en OTRA tabla, no en la objetivo → confusión probable;
//     requiere revisión humana (el CLI/test la informan pero NO fallan).
//
// Limitación documentada (aceptada): los payloads construidos como variables
// (no como objeto literal en la llamada) no son verificables estáticamente. El
// fix durable es tipar los clientes con lib/types/database-generated.ts, que
// hace imposible el bug en compilación.
//
// Fuente del esquema: OpenAPI de PostgREST (la misma que el generador de tipos
// y el test invariante multitenant) — funciona en CI con service_role y el test
// salta sin credenciales. Uso:
//   node scripts/auditar-columnas-fantasma.mjs          → informe + exit 1 si tier1
//   import { auditarColumnasFantasma } from '…'          → para el test de CI

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { leerEnvLocal } from './env-local.mjs'

const raizPorDefecto = join(dirname(fileURLToPath(import.meta.url)), '..')

// Esquema vivo: { tabla: [columnas] } desde el OpenAPI (PostgREST solo expone
// lo que el service_role ve en public — exactamente lo que la app puede tocar).
export async function esquemaVivo() {
  const env = leerEnvLocal()
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_URL ||
    env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).replace(/\/+$/, '')
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SECRET_KEY
  if (!url || !key) return null
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  })
  if (!res.ok) return null
  const spec = await res.json()
  const esquema = {}
  for (const [nombre, def] of Object.entries(spec.definitions || {})) {
    const tabla = nombre.replace(/^public\./, '')
    esquema[tabla] = Object.keys(def.properties || {})
  }
  return esquema
}

// ── splitTop: divide por comas de nivel 0 respetando paréntesis y strings ────
const splitTop = (s) => {
  const out = []
  let d = 0,
    cur = '',
    q = null
  for (const ch of s) {
    if (q) {
      cur += ch
      if (ch === q) q = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      q = ch
      cur += ch
      continue
    }
    if (ch === '(') d++
    if (ch === ')') d--
    if (ch === ',' && d === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

const normToken = (t) => {
  t = t.trim().replace(/\$\{[^}]*\}/g, '')
  if (!t || t === '*' || t.startsWith('*')) return null
  t = t.split('::')[0]
  t = t.replace(/->>?\s*'[^']*'\s*$/, '')
  if (t.includes('(')) return null
  const m = t.match(/^([\w.]+)$/)
  if (!m) return null
  let col = m[1]
  if (col.includes(':')) col = col.split(':').pop()
  col = col.trim()
  return /^[\w.]+$/.test(col) ? col : null
}

// ── tokenizador de objeto literal: devuelve claves a profundidad 1 ──────────
// Empieza en el índice del `{`. Salta strings, comentarios // y /* */.
// state: expectKey tras '{' o ',' a profundidad 1.
const objectKeys = (src, braceIdx) => {
  const keys = []
  let i = braceIdx
  let d = 0,
    q = null,
    expectKey = false
  const n = src.length
  while (i < n) {
    const ch = src[i]
    const two = src.slice(i, i + 2)
    if (q) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === q) q = null
      i++
      continue
    }
    if (two === '//') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (two === '/*') {
      i = src.indexOf('*/', i + 2)
      if (i === -1) break
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      q = ch
      i++
      continue
    }
    if (ch === '{' || ch === '[') {
      d++
      if (d === 1) expectKey = true
      i++
      continue
    }
    if (ch === '}' || ch === ']') {
      d--
      if (d === 0) break
      expectKey = false
      i++
      continue
    }
    if (ch === ',') {
      if (d === 1) expectKey = true
      i++
      continue
    }
    if (d === 1 && expectKey && /\w|["']/.test(ch)) {
      const m = src.slice(i).match(/^(['"`]?)(\w+)\1\s*:/)
      if (m) {
        keys.push(m[2])
        i += m[0].length
        expectKey = false
        continue
      }
      // token sin ':' → no es clave (expresión). Salta el token.
      const w = src.slice(i).match(/^[\w$]+/)
      if (w) {
        i += w[0].length
        continue
      }
    }
    i++
  }
  return keys
}

// variante que solo tokeniza hasta el cierre del objeto abierto
function objectKeysCapped(region, openIdx) {
  let d = 0,
    q = null
  for (let i = openIdx; i < region.length; i++) {
    const ch = region[i]
    const two = region.slice(i, i + 2)
    if (q) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === q) q = null
      continue
    }
    if (two === '//') {
      while (i < region.length && region[i] !== '\n') i++
      continue
    }
    if (two === '/*') {
      i = region.indexOf('*/', i + 2)
      if (i === -1) return region.length - 1
      i += 2
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      q = ch
      continue
    }
    if (ch === '{' || ch === '[') d++
    if (ch === '}' || ch === ']') {
      d--
      if (d === 0) return i
    }
  }
  return region.length - 1
}

const uniq = (arr) => {
  const seen = new Map()
  for (const f of arr) {
    const k = `${f.file}:${f.line}:${f.table}.${f.col}:${f.via}`
    if (!seen.has(k)) seen.set(k, f)
  }
  return [...seen.values()]
}

export async function auditarColumnasFantasma({ raiz = raizPorDefecto, esquema = null } = {}) {
  const schema = esquema || (await esquemaVivo())
  if (!schema) return { disponible: false, t1: [], t2: [], archivosEscaneados: 0 }

  const allCols = new Set(Object.values(schema).flat())
  const tables = new Set(Object.keys(schema))
  const findings = []
  const add = (tier, table, col, file, line, via) =>
    findings.push({ tier, table, col, file: relative(raiz, file), line, via })

  const files = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        if (['node_modules', '.next', '.git', '.freebuff', '.agents', '.claude'].includes(e.name)) continue
        walk(p)
      } else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/database-generated/.test(e.name)) files.push(p)
    }
  }
  for (const d of ['app', 'lib', 'components', 'hooks', 'tests']) {
    try {
      statSync(join(raiz, d))
      walk(join(raiz, d))
    } catch {}
  }

  const FILTER_RE =
    /\.(eq|neq|gt|gte|lt|lte|like|ilike|match|not|in|contains|containedBy|overlaps|textSearch|order)\(\s*['"`]([\w.>]+)['"`]/g
  const SELECT_RE = /\.select\(\s*([`'"])([\s\S]*?)\1/g
  // payload literal: .update({  |  .upsert({  |  .insert({  |  .insert([
  const WRITE_RE = /\.(update|upsert|insert)\(\s*(?=(\{|\[))/g

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const lineOf = (idx) => src.slice(0, idx).split('\n').length
    const froms = [...src.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)/g)]
    for (let fi = 0; fi < froms.length; fi++) {
      const table = froms[fi][1]
      if (!tables.has(table)) continue
      const start = froms[fi].index
      const nextAnyFrom = src.indexOf('.from(', start + 10)
      const end = Math.min(
        fi + 1 < froms.length ? froms[fi + 1].index : src.length,
        nextAnyFrom === -1 ? src.length : nextAnyFrom,
        start + 3000
      )
      const region = src.slice(start, end)

      for (const m of region.matchAll(SELECT_RE)) {
        for (const partRaw of splitTop(m[2])) {
          const part = partRaw.trim()
          const emb = part.match(/^(\w+)\s*\(([\s\S]*)\)\s*$/)
          if (emb) {
            const rel = emb[1]
            const relTable = tables.has(rel)
              ? rel
              : tables.has(rel.replace(/e?s$/, ''))
                ? rel.replace(/e?s$/, '')
                : null
            if (relTable) {
              for (const inner of splitTop(emb[2])) {
                const c = normToken(inner.trim())
                if (!c || c.includes('.')) continue
                if (!schema[relTable].includes(c)) {
                  add(allCols.has(c) ? 2 : 1, relTable, c, file, lineOf(start + m.index), `select ${rel}()`)
                }
              }
            }
            continue
          }
          const c = normToken(part)
          if (!c || c.includes('.')) continue
          if (!schema[table].includes(c)) {
            add(allCols.has(c) ? 2 : 1, table, c, file, lineOf(start + m.index), 'select')
          }
        }
      }

      for (const m of region.matchAll(FILTER_RE)) {
        let col = m[2]
        let target = table
        if (col.includes('.')) {
          const [rel, c] = col.split('.')
          const relTable = tables.has(rel) ? rel : null
          if (!relTable) continue
          col = c
          target = relTable
        }
        if (col.includes('>')) continue
        if (!schema[target]?.includes(col)) {
          add(allCols.has(col) ? 2 : 1, target, col, file, lineOf(start + m.index), m[1] + '()')
        }
      }

      for (const m of region.matchAll(
        /\.or\(\s*[`'"]([^`'"]+)[`'"]\s*(,\s*\{[^}]*foreignTable\s*:\s*['"](\w+)['"][^}]*\})?/g
      )) {
        const orFt = m[2] && tables.has(m[3]) ? m[3] : null
        for (const cond of splitTop(m[1])) {
          const c = cond.match(/^([\w.]+)\.(eq|neq|gt|gte|lt|lte|like|ilike|in|is)\b/)
          if (!c) continue
          let col = c[1]
          let orTarget = table
          if (orFt) {
            // Con foreignTable, TODAS las condiciones aplican a la tabla foránea
            // (con o sin prefijo `tabla.`): PostgREST no mezcla ámbitos aquí.
            col = col.includes('.') ? col.split('.').pop() : col
            orTarget = orFt
          } else if (col.includes('.')) {
            const [rel, cc] = col.split('.')
            if (tables.has(rel)) {
              col = cc
              orTarget = rel
            } else continue
          }
          if (!schema[orTarget]?.includes(col)) {
            add(allCols.has(col) ? 2 : 1, orTarget, col, file, lineOf(start + m.index), 'or()')
          }
        }
      }

      for (const m of region.matchAll(WRITE_RE)) {
        const openIdx = region.indexOf('{', m.index + m[0].length - 1)
        if (openIdx === -1) continue
        // limitar al objeto: busca su cierre para no invadir llamadas siguientes
        const closeIdx = objectKeysCapped(region, openIdx)
        const keys = objectKeys(region.slice(0, closeIdx + 1), openIdx)
        for (const k of keys) {
          if (!schema[table]?.includes(k)) {
            add(allCols.has(k) ? 2 : 1, table, k, file, lineOf(start + m.index), m[1] + '()')
          }
        }
      }
    }
  }

  const t1 = uniq(findings.filter((f) => f.tier === 1))
  const t2 = uniq(findings.filter((f) => f.tier === 2))
  return { disponible: true, t1, t2, archivosEscaneados: files.length }
}

const formatear = (r) =>
  [...r.t1, ...r.t2]
    .map((f) => `${f.tier === 1 ? 'TIER1' : 'tier2'}  ${f.file}:${f.line}  ${f.table}.${f.col}  (vía ${f.via})`)
    .join('\n')

// Entrada CLI: node scripts/auditar-columnas-fantasma.mjs
const esCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (esCli) {
  const r = await auditarColumnasFantasma()
  if (!r.disponible) {
    console.error('Sin credenciales de Supabase: no se puede obtener el esquema vivo.')
    process.exit(2)
  }
  console.log(`Archivos escaneados: ${r.archivosEscaneados}`)
  console.log(`tier1 (columna no existe en ninguna tabla → 400 garantizado): ${r.t1.length}`)
  console.log(`tier2 (existe en otra tabla — revisar a mano): ${r.t2.length}`)
  if (r.t1.length || r.t2.length) console.log(formatear(r))
  process.exit(r.t1.length ? 1 : 0)
}
