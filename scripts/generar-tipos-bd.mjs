// Genera lib/types/database-generated.ts desde el esquema VIVO de Supabase.
//
// Los tipos de app (lib/types/database.ts) se escriben a mano porque modelan la app, no la BD;
// su contrapartida "espejo exacto del esquema" NO se mantiene a mano: se desincroniza (ver
// auditoría FASE 1: campos fantasma attribution_* que ya no existían en la BD). Este script
// produce ese espejo mecánicamente a partir del OpenAPI de PostgREST — la misma fuente que usa
// `supabase gen types typescript` pero sin necesitar CLI ni login ni proyecto linked.
//
// Uso: npm run tipos:bd
// El OpenAPI completo requiere service_role (PostgREST 14 oculta la raíz a anon), así que la
// clave se lee de .env.local o del entorno y NUNCA se imprime. El fichero generado se COMITEA
// para que typecheck/IDE funcionen sin BD, y se regenera cuando cambie el esquema. El test
// tests/esquema-tenant-invariante.test.mjs comprueba que el artefacto no se queda viejo.

import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { leerEnvLocal } from './env-local.mjs'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const destino = join(raiz, 'lib/types/database-generated.ts')

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
if (!url || !key) {
  console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (en .env.local o entorno).')
  process.exit(1)
}

const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
})
if (!res.ok) {
  console.error(`OpenAPI de PostgREST no disponible (HTTP ${res.status}).`)
  process.exit(1)
}
const spec = await res.json()
const defs = spec.definitions || {}
const nombres = Object.keys(defs).sort()

const pascal = (s) => s.replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase())

const tsArrayElement = (p) => {
  const el = p.items?.format ?? 'string'
  if (el === 'boolean') return 'boolean'
  if (el === 'integer' || el === 'smallint') return 'number'
  if (el === 'json' || el === 'jsonb') return 'Json'
  if (el === 'bigint' || el === 'numeric') return 'number | string'
  return 'string'
}

const tipoTs = (p) => {
  let base
  switch (p.format) {
    case 'uuid':
    case 'text':
    case 'date':
    case 'time with time zone':
    case 'time without time zone':
    case 'timestamp with time zone':
    case 'timestamp without time zone':
    case 'character varying':
    case 'character':
      base = 'string'
      break
    case 'bigint':
    case 'numeric':
      base = 'number | string'
      break
    case 'integer':
    case 'smallint':
    case 'double precision':
    case 'real':
      base = 'number'
      break
    case 'boolean':
      base = 'boolean'
      break
    case 'json':
    case 'jsonb':
      base = 'Json'
      break
    case 'ARRAY':
      base = `${tsArrayElement(p)}[]`
      break
    default:
      base = 'string'
  }
  return p.nullable === false ? base : `${base} | null`
}

const bloques = []
for (const nombre of nombres) {
  const t = defs[nombre]
  const props = t.properties || {}
  const required = new Set(t.required || [])
  const tabla = pascal(nombre.replace(/^public\./, ''))

  const row = Object.entries(props)
    .map(([campo, p]) => `      ${campo}: ${tipoTs(p)}`)
    .join('\n')
  const insert = Object.entries(props)
    .map(([campo, p]) => {
      const conDefault = p.default !== undefined && p.default !== null
      const obligatorio = required.has(campo) && !conDefault && p.nullable === false
      const base = tipoTs(p)
      return `      ${campo}: ${obligatorio ? base : `${base} | undefined`}`
    })
    .join('\n')
  const update = Object.entries(props)
    .map(([campo, p]) => `      ${campo}: ${tipoTs(p).replace(/ \| null$/, '')} | undefined`)
    .join('\n')

  bloques.push(`    ${tabla}: {
      Row: {
${row}
      }
      Insert: {
${insert}
      }
      Update: {
${update}
      }
    }`)
}

const out = `// GENERADO — no editar a mano. Fuente: OpenAPI de PostgREST (${new Date().toISOString()}).
// Regenerar con: npm run tipos:bd  (y commitear). El test tests/esquema-tenant-invariante.test.mjs
// comprueba que este artefacto sigue fresco respecto al esquema vivo.
// Espejo exacto del esquema public de Supabase; los tipos de APP siguen en lib/types/database.ts.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type EsquemaPublico = {
  Tables: {
${bloques.join('\n')}
  }
}
`

writeFileSync(destino, out)
// El quality gate exige formato Prettier: el artefacto sale ya conforme.
execSync(`npx prettier --write "${destino}"`, { stdio: 'inherit', cwd: raiz })
console.log(`Escrito lib/types/database-generated.ts — ${nombres.length} relaciones del esquema público.`)
