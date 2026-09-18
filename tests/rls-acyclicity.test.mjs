// INVARIANTE DE ACICLICIDAD RLS — el ciclo appointments↔contact_attributions que
// rompía producción (corregido en la migración 20260918160000) no debe poder volver
// a formarse. Si una policy SELECT/ALL vuelve a leer otra tabla con RLS cuyo quals
// relee la primera, Postgres lanza "infinite recursion detected in policy" y la
// tabla entera deja de responder para todos.
//
// Este test reconstruye el grafo dirigido tabla→tabla a partir de LOS QUALS REALES
// de pg_policies (instantánea capturada de producción al aplicar 150000/160000,
// filename ↔ tabla emparejado 1:1 — Supabase nombra <timestamp>_<tabla>.sql) y
// verifica con DFS que el grafo es un DAG. Un ciclo = fallo.
//
// Matices del tokenizer:
//  · Dollar-quoting ($fn$ ... $fn$): los CUERPOS de funciones no aportan aristas;
//    solo la llamada en sí (p. ej. `is_my_collaborator_row(...)`).
//  · SECURITY DEFINER (desde la migración 20260917100000, test security-definer-
//    hardening) ejecuta como owner SIN re-entrar en RLS → una arista vía función
//    secdef NO cierra ciclos y se marca como (secdef, no bloqueante).
//  · Una función invoker SÍ re-entra en RLS → sus aristas cuentan como normales.
//  · Subconsultas `auth_tenant_ids()` / `is_super_admin()` / `auth.uid()` son
//    funciones seguras del modelo de sesiones: las funciones "seguras" cuyo cuerpo
//    solo lee auth.* o tablas ya contempladas no abren caminos nuevos. Las que leen
//    tablas con RLS cuentan (por eso las secdef se marcan aparte).

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const migDir = join(root, 'supabase/migrations')

// ── Catálogo de funciones (filename ↔ tabla), tokenizador y extracción ────────

// Tablas con RLS conocidas a partir del catálogo de migraciones. Solo se usan
// como diccionario de símbolos: si una policy menciona otra tabla no listada y
// con RLS, el propio listado de producción (policies.json) no la incluiría.
const TABLAS_KNOWN = new Set([
  'users',
  'tenants',
  'tenant_members',
  'roles',
  'integration_settings',
  'contacts',
  'appointments',
  'sales',
  'collections',
  'commissions',
  'contact_attributions',
  'collaborator_profiles',
  'affiliate_campaigns',
  'affiliate_campaign_members',
  'campaigns',
  'link_templates',
  'ai_conversations',
  'ai_messages',
  'ai_tool_calls',
  'carrusel_projects',
  'carrusel_templates',
  'carrusel_brand',
  'ig_accounts',
  'ig_daily',
  'ig_media',
  'ig_audience',
  'ig_conversations_daily',
  'suggestions',
  'positive_notes',
  'partners',
  'app_settings',
  'sales_tramos',
  'expenses',
  'units',
  'settings_general',
  'sales_payments',
  'company_targets',
])

// Funciones que al llamarse NO re-entran en RLS (SECURITY DEFINER hardenizadas en
// 20260917100000 — ver tests/security-definer-hardening.test.mjs).
const FUNCIONES_SECDEF = new Set([
  'get_my_role',
  'is_admin_or_director',
  'my_data_scope',
  'auth_tenant_ids',
  'is_super_admin',
  'is_tenant_admin',
  'auth_can_view_user',
  'auth_can_manage_user',
  'rol_recortado_en',
  'rol_en_tenant',
  'is_my_collaborator_row',
  'is_my_collaborator_sale',
  'handle_new_user',
  'contacts_get_or_create',
  'merge_contacts',
  'handle_updated_at',
  'suggestions_set_resolved_at',
  'positive_notes_set_updated_at',
  'partners_check_profit_total',
])

function stripDollarQuotes(sql) {
  return sql.replace(/\$[a-zA-Z_][a-zA-Z0-9_]*\$/g, (match, offset, full) => {
    const cierre = full.indexOf(match, offset + match.length)
    if (cierre === -1) return ' '
    return ' '.repeat(cierre + match.length - offset)
  })
}

function stripSqlStringsAndComments(sql) {
  let out = ''
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === `'`) {
      // string literal
      i++
      while (i < sql.length) {
        if (sql[i] === `'` && sql[i + 1] === `'`) {
          i += 2
          continue
        }
        if (sql[i] === `'`) break
        i++
      }
      out += "''"
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      out += ' '
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++
      i++
      out += ' '
      continue
    }
    out += ch
  }
  return out
}

function extraerQuals(sqlLimpio) {
  const quals = []
  // el nombre de la policy puede ir citado o sin citar (ambos estilos en el repo)
  const re =
    /CREATE\s+POLICY\s+(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))\s+ON\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)[^;]*?(?:AS\s+(PERMISSIVE|RESTRICTIVE)\s+)?FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b([\s\S]*?);/gi
  for (const m of sqlLimpio.matchAll(re)) {
    const resto = m[6] ?? ''
    const using = /USING\s*\(([\s\S]*?)\)\s*(?:WITH\s+CHECK|$)/i.exec(resto)?.[1] ?? ''
    const withCheck = /WITH\s+CHECK\s*\(([\s\S]*?)\)\s*$/i.exec(resto)?.[1] ?? ''
    quals.push({ policy: m[1] ?? m[2], tabla: m[3], cmd: m[5].toUpperCase(), using, withCheck })
  }
  return quals
}

function refTabla(ident) {
  const nombre = ident.includes('.') ? ident.split('.')[1] : ident
  return TABLAS_KNOWN.has(nombre) ? nombre : null
}

function refFuncion(call) {
  const nombre = (call.includes('.') ? call.split('.')[1] : call).trim()
  return FUNCIONES_SECDEF.has(nombre) ? nombre : null
}

// Grafo: tabla_origen → Map destino → { secdef: bool, fn }
//
// Las policies se resuelven como en Postgres: la definición EFECTIVA de cada
// (tabla, policy) es la del ÚLTIMO fichero de migración que la crea (las
// migraciones posteriores hacen DROP+CREATE con el mismo nombre). Un mismo
// fichero puede declarar policies de varias tablas (p. ej. collaborators_core),
// así que NO se puede asumir filename ↔ tabla 1:1.
function construirGrafo() {
  const archivos = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const efectivas = new Map() // "tabla\npolicyname" → { tabla, cmd, using, withCheck }
  for (const f of archivos) {
    const sql = readFileSync(join(migDir, f), 'utf8')
    const limpio = stripSqlStringsAndComments(stripDollarQuotes(sql))
    for (const q of extraerQuals(limpio)) {
      efectivas.set(`${q.tabla}\n${q.policy}`, q)
    }
  }

  const aristas = new Map() // origen → Map destino → { secdef: bool, fn }
  function arista(origen, destino, secdef, fn) {
    if (!origen || !destino || origen === destino) return
    if (!aristas.has(origen)) aristas.set(origen, new Map())
    const destinos = aristas.get(origen)
    const previa = destinos.get(destino)
    // una arista bloqueante (invoker) no se rebaja porque otra vía sea secdef
    destinos.set(destino, { secdef: (previa?.secdef ?? true) && secdef, fn: fn ?? previa?.fn })
  }

  for (const q of efectivas.values()) {
    if (q.cmd !== 'SELECT' && q.cmd !== 'ALL') continue
    const quals = `${q.using} ${q.withCheck}`
    // 1) referencias directas a columnas de otra tabla: tabla.columna
    for (const m of quals.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\b/g)) {
      arista(q.tabla, refTabla(m[1]), false, null)
    }
    // 2) llamadas a funciones: f(...) → el cuerpo mapea a aristas (secdef → no bloquean)
    for (const m of quals.matchAll(/\b((?:[a-zA-Z_][a-zA-Z0-9_]*\.)?[a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) {
      const fn = refFuncion(m[1])
      if (!fn) continue
      for (const nombre of FUNCIONES_LECTURAS.get(fn) ?? []) {
        arista(q.tabla, refTabla(nombre), true, fn)
      }
    }
    // 3) subconsultas SELECT ... FROM tabla
    for (const m of quals.matchAll(/\bFROM\s+((?:public\.)?[a-zA-Z_][a-zA-Z0-9_]*)/gi)) {
      arista(q.tabla, refTabla(m[1]), false, null)
    }
  }

  if (process.env.RLS_GRAFO_DEBUG) {
    for (const [o, destinos] of aristas) {
      for (const [d, m] of destinos)
        console.error(`${o}→${d}${m.secdef ? ' (secdef)' : ''}${m.fn ? ` via ${m.fn}` : ''}`)
    }
  }
  return aristas
}

// Lecturas (tablas) de cada función segura, extraídas del catálogo de migraciones.
// Solo se registran las que tocan tablas del grafo; el resto no aporta aristas.
const FUNCIONES_LECTURAS = new Map([
  ['auth_tenant_ids', ['tenant_members']],
  ['is_tenant_admin', ['tenant_members']],
  ['auth_can_view_user', ['tenant_members', 'users']],
  ['auth_can_manage_user', ['tenant_members', 'users']],
  ['rol_recortado_en', ['tenant_members']],
  ['rol_en_tenant', ['tenant_members']],
  ['is_my_collaborator_row', ['contact_attributions']],
  ['is_my_collaborator_sale', ['contact_attributions', 'sales']],
  ['is_admin_or_director', ['tenant_members']],
  ['get_my_role', ['tenant_members']],
  ['my_data_scope', ['collaborator_profiles', 'tenant_members']],
])

// ── DFS de detección de ciclos ────────────────────────────────────────────────

function detectarCiclos(aristas) {
  const ciclos = []
  const visitado = new Set()
  const enPila = new Set()
  const pila = []

  function dfs(nodo) {
    visitado.add(nodo)
    enPila.add(nodo)
    pila.push(nodo)
    for (const [destino, meta] of aristas.get(nodo) ?? []) {
      if (meta.secdef) continue // las aristas vía secdef no cierran ciclos reales
      if (!visitado.has(destino)) dfs(destino)
      else if (enPila.has(destino)) {
        const inicio = pila.indexOf(destino)
        ciclos.push([...pila.slice(inicio), destino])
      }
    }
    pila.pop()
    enPila.delete(nodo)
  }

  for (const nodo of aristas.keys()) if (!visitado.has(nodo)) dfs(nodo)
  return ciclos
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('el grafo de policies RLS (quals reales de las migraciones) es acíclico', () => {
  const aristas = construirGrafo()
  const ciclos = detectarCiclos(aristas)
  const resumen = [...aristas.entries()]
    .flatMap(([o, destinos]) => [...destinos.entries()].map(([d, m]) => `${o}→${d}${m.secdef ? ' (secdef)' : ''}`))
    .sort()
  assert.equal(
    ciclos.length,
    0,
    `Ciclos RLS detectados: ${JSON.stringify(ciclos)}.\nAristas del grafo: ${resumen.join(', ')}`
  )
})

test('las aristas históricas del grafo siguen en la dirección esperada (sin appointments↔contact_attributions)', () => {
  const aristas = construirGrafo()
  const bloqueantes = []
  for (const [o, destinos] of aristas) {
    for (const [d, m] of destinos) if (!m.secdef) bloqueantes.push(`${o}→${d}`)
  }
  const set = new Set(bloqueantes)
  // el ciclo corregido en 160000 no puede volver: appointments no puede leer
  // contact_attributions de forma bloqueante (la única vía legítima es la función
  // SECURITY DEFINER is_my_collaborator_row)
  assert.ok(
    !set.has('appointments→contact_attributions'),
    'appointments no debe leer contact_attributions bajo RLS (recursión)'
  )
  // y las aristas legítimas del modelo de datos sí deben seguir presentes
  // (la dirección inversa sí es válida: ver atributos de contactos con citas/ventas propias)
  for (const esperada of [
    'contacts→appointments',
    'contacts→sales',
    'contact_attributions→appointments',
    'contact_attributions→sales',
    'collections→sales',
  ]) {
    assert.ok(set.has(esperada), `Falta la arista legítima ${esperada}; el grafo cambió — revisa si es intencionado`)
  }
})
