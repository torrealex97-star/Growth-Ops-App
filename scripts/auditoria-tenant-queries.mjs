// Escáner FASE 3 (multitenant): en código que usa SUPABASE_SERVICE_ROLE_KEY (RLS bypaseado),
// toda query a una tabla con tenant_id debe filtrar/estampar la columna explícitamente.
// Exporta la lógica para tests/fase3-tenant-queries.test.mjs; el modo CLI imprime el informe.
//
// Alcance del barrido: app/api/[tenant]/**/route.ts + módulos de lib/ con cliente service-role
// (los helpers son el punto ciego clásico del escáner de rutas: ahí ocurrió la fuga real de
// testimonios). Los candidatos requieren revisión manual: una query a tenants/users, una
// propagación de error o un campo contable no son fugas.
//
// Uso: node scripts/auditoria-tenant-queries.mjs [--json]

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(import.meta.dirname, '..')

// Tablas con tenant_id, según el espejo generado del esquema (fuente de verdad).
// Se normaliza a minúsculas: el artefacto nombra las tablas en PascalCase (Sales) pero las
// queries usan el identificador real en snake_case ('sales'). Sin esta normalización el
// lookup falla siempre y el escáner NO encontraría nunca candidatos (fallo que el test
// sintético de fuga destapó).
function tablasConTenant() {
  const generados = readFileSync(join(raiz, 'lib/types/database-generated.ts'), 'utf8')
  const set = new Set()
  for (const m of generados.matchAll(/^    ([A-Za-z0-9]+): \{$/gm)) {
    const cuerpo = generados.slice(m.index, generados.indexOf('\n    }', m.index))
    if (/^        tenant_id:/m.test(cuerpo)) set.add(m[1].toLowerCase())
  }
  return set
}

// Tablas globales (sin tenant_id) — las queries a ellas no necesitan el filtro.
export const GLOBALES = new Set(['tenants', 'roles', 'users', 'resource_links', 'resource_link_divisions'])

function* walkRoutes(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkRoutes(ruta)
    else if (entry.isFile() && entry.name === 'route.ts') yield ruta
  }
}

/**
 * Blanquea líneas de comentario `// …` preservando la longitud total (los índices de matchAll
 * siguen siendo válidos contra el texto original). Evita el falso positivo de documentación
 * que menciona `.from('tabla')` (p. ej. el comentario de sales/delete). Una línea cuyo `//`
 * forma parte de una URL ('https://…') se detecta por la comilla previa y NO se blanquea.
 */
function sinComentarios(texto) {
  return texto
    .split('\n')
    .map((linea) => {
      const idx = linea.indexOf('//')
      if (idx < 0 || linea.slice(0, idx).includes("'")) return linea
      return linea.slice(0, idx) + ' '.repeat(linea.length - idx)
    })
    .join('\n')
}

/** Escanea rutas y lib service-role; devuelve { resumen, candidatos }. */
export function escanear() {
  const conTenant = tablasConTenant()
  const candidatos = []
  const resumen = { rutasService: 0, rutasRls: 0, queriesServiceRevisadas: 0, ficherosLibRevisados: 0 }

  for (const ruta of walkRoutes(join(raiz, 'app/api/[tenant]'))) {
    const texto = readFileSync(ruta, 'utf8')
    const esService = texto.includes('SUPABASE_SERVICE_ROLE_KEY')
    if (esService) resumen.rutasService++
    else resumen.rutasRls++
    if (!esService) continue // rutas anon/auth: RLS es el backstop (otra fase)

    const relativa = ruta.slice(raiz.length + 1)
    const escaneable = sinComentarios(texto)
    for (const m of escaneable.matchAll(/\.from\(\s*'([a-z_]+)'/g)) {
      resumen.queriesServiceRevisadas++
      if (!conTenant.has(m[1]) || GLOBALES.has(m[1])) continue
      // HACIA DELANTE: el chain filtra con .eq('tenant_id', …) o el insert/upsert/patch lleva
      // el estampado inline ({ ...values, tenant_id }).
      const ventana = texto.slice(m.index, m.index + 1500)
      if (/\.eq\('tenant_id'|tenant_id:|\btenant_id\b/.test(ventana)) continue
      // HACIA ATRÁS: el objeto insertado/upserteado suele construirse ANTES de la query
      // (.insert(clean) donde clean ya lleva tenant_id). Solo cuenta la forma de estampado
      // `tenant_id:` — el .eq de otra query anterior no blanca esta.
      const atras = texto.slice(Math.max(0, m.index - 3000), m.index)
      if (/tenant_id:/.test(atras)) continue
      candidatos.push({ fichero: relativa, linea: texto.slice(0, m.index).split('\n').length, tabla: m[1] })
    }

    // RPCs de plataforma sin parámetro de tenant en service-role: potencial alcance global.
    for (const m of texto.matchAll(/\.rpc\(\s*'([a-z_]+)'\s*\)/g)) {
      if (['attribution_funnel', 'auth_tenant_ids'].includes(m[1])) {
        candidatos.push({
          fichero: relativa,
          linea: texto.slice(0, m.index).split('\n').length,
          tabla: `rpc:${m[1]}`,
        })
      }
    }
  }
  // Helpers de lib/ con cliente service-role: punto ciego del escáner de rutas.
  for (const nombre of [
    'app-settings.ts',
    'testimonios.ts',
    'carruseles/store.ts',
    'sequra/syncDelinquents.ts',
    'config.ts',
    'funnels/queries.ts',
  ]) {
    const ruta = join(raiz, 'lib', nombre)
    let texto
    try {
      texto = readFileSync(ruta, 'utf8')
    } catch {
      continue
    }
    resumen.ficherosLibRevisados++
    const relativa = `lib/${nombre}`
    for (const m of texto.matchAll(/\.from\(\s*'([a-z_]+)'/g)) {
      resumen.queriesServiceRevisadas++
      if (!conTenant.has(m[1]) || GLOBALES.has(m[1])) continue
      const ventana = texto.slice(m.index, m.index + 1500)
      if (/\.eq\('tenant_id'|tenant_id:|\btenant_id\b/.test(ventana)) continue
      candidatos.push({ fichero: relativa, linea: texto.slice(0, m.index).split('\n').length, tabla: m[1] })
    }
  }

  return { resumen, candidatos }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('auditoria-tenant-queries.mjs')) {
  const { resumen, candidatos } = escanear()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ ...resumen, candidatos }, null, 2))
  } else {
    console.log(
      `Rutas service-role: ${resumen.rutasService} · rutas RLS: ${resumen.rutasRls} · ficheros lib revisados: ${resumen.ficherosLibRevisados} · queries service-role revisadas: ${resumen.queriesServiceRevisadas}`
    )
    console.log(`Candidatos a revisar: ${candidatos.length}`)
    for (const c of candidatos) console.log(`  ${c.fichero}:${c.linea} → ${c.tabla}`)
  }
}
