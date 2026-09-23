import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { leerEnvLocal } from '../scripts/env-local.mjs'

import { EXCEPCIONES_SIN_TENANT } from '../lib/seguridad/invariante-tenant.ts'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

const env = leerEnvLocal()
const url = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  env.SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/+$/, '')
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SECRET_KEY
const anonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Excepciones CERRADAS: tablas globales de plataforma sin tenant_id, cada una con su motivo.
//
// La lista VIVE EN UN SOLO SITIO (`lib/seguridad/invariante-tenant.ts`). Antes había una copia aquí
// y otra allí, y pasó lo que pasa siempre: al declarar `event_types` como excepción, la de allí se
// actualizó y esta se quedó vieja, así que el test rompió en CI señalando una tabla que SÍ estaba
// declarada. Una lista duplicada no protege el doble: protege la mitad y miente la otra mitad.
const SIN_TENANT = new Set(Object.keys(EXCEPCIONES_SIN_TENANT))

async function openapi() {
  // El OpenAPI completo requiere service_role (PostgREST 14 oculta la raíz a anon).
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: 'application/openapi+json' },
  })
  assert.equal(res.ok, true, `OpenAPI de PostgREST no disponible (HTTP ${res.status})`)
  return res.json()
}

test(
  'invariante multitenant: toda tabla public tiene tenant_id NOT NULL (salvo excepciones cerradas)',
  { timeout: 30_000 },
  async (t) => {
    if (!url || !serviceKey) {
      return t.skip(
        'sin SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en el entorno: el invariante se comprueba donde sí las hay'
      )
    }
    const spec = await openapi()
    const defs = spec.definitions || {}
    const tablas = Object.keys(defs).filter(
      (n) => !['roles', 'users', 'resource_links', 'resource_link_divisions'].includes(n.replace(/^public\./, ''))
    )

    // ~90 tablas de negocio: un esquema mucho menor significa que estamos leyendo otra cosa.
    assert.ok(
      tablas.length >= 60,
      `esquema inesperadamente pequeño (${tablas.length}): revisar contra qué proyecto apunta SUPABASE_URL`
    )

    const violaciones = []
    for (const nombre of tablas) {
      const tabla = nombre.replace(/^public\./, '')
      if (SIN_TENANT.has(tabla)) continue
      const props = defs[nombre].properties || {}
      const required = defs[nombre].required || []
      if (!props.tenant_id) violaciones.push(`${tabla}: sin columna tenant_id`)
      else if (!required.includes('tenant_id'))
        violaciones.push(`${tabla}: tenant_id nullable o con default (una fila podría nacer huérfana)`)
    }
    assert.deepEqual(
      violaciones,
      [],
      `tablas que violan el invariante tenant_id — o les falta la columna, o admiten NULL:\n  ${violaciones.join('\n  ')}`
    )
  }
)

test('el artefacto de tipos generado está fresco respecto al esquema vivo', { timeout: 30_000 }, async (t) => {
  if (!url || !serviceKey)
    return t.skip('sin credenciales en el entorno: el ciclo de drift se comprueba donde sí las hay')

  const artefacto = readFileSync(join(raiz, 'lib/types/database-generated.ts'), 'utf8')

  const spec = await openapi()
  const tablasVivas = Object.keys(spec.definitions || {}).sort()
  // El artefacto nombra las tablas en PascalCase (misma transformación que el generador).
  const pascal = (s) => s.replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase())
  const remoto = new Set(tablasVivas.map((n) => pascal(n.replace(/^public\./, ''))))
  // Tablas declaradas en el artefacto (encabezados `    Tabla: {` a nivel de Tables, indentados por Prettier).
  const enArtefacto = new Set([...artefacto.matchAll(/^    ([A-Za-z0-9]+): \{$/gm)].map((m) => m[1]))

  const faltan = [...remoto].filter((t) => !enArtefacto.has(t))
  const sobran = [...enArtefacto].filter((t) => !remoto.has(t))
  assert.deepEqual(
    { faltan, sobran },
    { faltan: [], sobran: [] },
    'lib/types/database-generated.ts está desfasado — ejecuta `npm run tipos:bd` y commitea'
  )
  void anonKey
})
