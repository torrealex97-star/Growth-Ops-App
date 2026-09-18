import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

// REGLA DE NO-ENUMERACIÓN DE SUBCUENTAS (§42 del brief multitenant):
// la home pública NUNCA puede listar todas las subcuentas del sistema sin sesión.
// Antes: query anon `select slug,name from tenants where status=active` mostraba los
// nombres de TODOS los clientes a cualquiera. Ahora: solo se listan tras autenticarse
// (y RLS limita a las subcuentas propias).
test('la home no enumera subcuentas sin sesión previa', () => {
  const src = read('app/page.tsx')
  // Debe comprobar autenticación ANTES de lanzar la query de tenants
  assert.match(src, /auth\.getUser\(\)/, 'la home debe resolver la sesión antes de listar')
  // Y la query de tenants debe estar condicionada a autenticado !== null
  assert.match(
    src,
    /if\s*\(\s*autenticado\s*===?\s*null\s*\)\s*return/,
    'la query de subcuentas no debe lanzarse sin saber quién eres'
  )
})

// AISLAMIENTO DE LOCALSTORAGE (§24 del brief): claves con estado de negocio de una
// subcuenta NO pueden vivir en una clave global del navegador.
test('localStorage con estado de negocio lleva namespace por subcuenta', () => {
  // Cola de guiones (contenido de negocio por tenant)
  const queue = read('components/os/ScriptQueue.tsx')
  assert.match(
    queue,
    /lsKeyFor\s*=\s*\(tenant[^)]*\)\s*=>\s*`tenant:\$\{tenant\}/,
    'ScriptQueue debe keyear su cola por tenant'
  )
  assert.doesNotMatch(
    queue,
    /localStorage\.(get|set)Item\('iaw_script_jobs'\)/,
    'ScriptQueue no debe usar la clave global antigua'
  )

  // Columnas de contactos (preferencia de trabajo por tenant)
  const cols = read('components/crm/ContactsAllView.tsx')
  assert.match(
    cols,
    /colsKeyFor\s*=\s*\(tenant[^)]*\)\s*=>\s*`tenant:\$\{tenant\}/,
    'ContactsAllView debe keyear columnas por tenant'
  )
  assert.doesNotMatch(
    cols,
    /localStorage\.(get|set)Item\('contacts_unified_cols'\)/,
    'ContactsAllView no debe usar la clave global antigua'
  )
})

// Las preferencias de carga deben re-evaluarse al cambiar de subcuenta: si el useEffect
// solo corre al montar, el primer render de la nueva subcuenta hereda el estado de la anterior.
// Comprobación simple y robusta: entre la lectura por-tenant y su cierre debe aparecer [tenant].
test('los useEffect de estado por-tenant se re-ejecutan al cambiar de tenant', () => {
  const queue = read('components/os/ScriptQueue.tsx')
  const resumeIdx = queue.indexOf('localStorage.getItem(lsKeyFor(tenant))')
  assert.ok(resumeIdx >= 0, 'ScriptQueue debe leer su cola con clave por tenant')
  const afterResume = queue.slice(resumeIdx, resumeIdx + 900)
  assert.match(afterResume, /\}, \[tenant\]\)/, 'el useEffect de reanudación debe depender de tenant')

  const cols = read('components/crm/ContactsAllView.tsx')
  const colsIdx = cols.indexOf('localStorage.getItem(colsKeyFor(tenant))')
  assert.ok(colsIdx >= 0, 'ContactsAllView debe leer columnas con clave por tenant')
  const afterCols = cols.slice(colsIdx, colsIdx + 600)
  assert.match(afterCols, /\}, \[tenant\]\)/, 'el useEffect de columnas debe depender de tenant')
})
