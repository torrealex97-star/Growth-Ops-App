import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const ROUTE = 'app/api/[tenant]/evergreen/settings/subcuentas/route.ts'
const PROVISION = 'lib/tenants/provision.ts'
const PAGE = 'app/[tenant]/settings/subcuentas/page.tsx'

// ARCHIVAR ≠ SUSPENDER. Suspender es una pausa temporal; archivar es el cierre ordenado de la
// relación comercial conservando los datos. Por eso 'archived' es un TERCER estado de
// tenants.status, no una bandera aparte: todos los gates ya bloquean cualquier estado ≠ 'active',
// así que un tercer estado hereda el bloqueo completo sin duplicar comprobaciones.
test('archivar es un tercer estado del mismo interruptor, no un mecanismo paralelo', () => {
  const sql = read('supabase/migrations/20260918100000_tenant_archived_status.sql')
  assert.match(sql, /status IN \('active', 'suspended', 'archived'\)/, 'la constraint debe admitir los 3 estados')
  assert.match(sql, /DROP CONSTRAINT IF EXISTS tenants_status_check/, 'la migración debe ser re-aplicable')
  const provision = sinComentarios(read(PROVISION))
  assert.match(provision, /TenantStatus = 'active' \| 'suspended' \| 'archived'/, 'el tipo del estado')
  // La operación escribe el MISMO campo `status` que suspender — no hay segunda vía de desactivación.
  const updates = [...provision.matchAll(/\.from\('tenants'\)\.update\(\{([^}]*)\}\)/g)].map((m) => m[1].trim())
  assert.ok(updates.length >= 1, 'setTenantStatus debe actualizar tenants.status')
  for (const u of updates) assert.equal(u, 'status', 'setTenantStatus solo escribe status')
})

// Archivar sin confirmación explícita del SERVIDOR sería un despido de un clic: la UI puede enviar
// el request sin querer (un doble clic, un re-submit). El servidor verifica confirmar:true Y el
// nombre exacto — la comparación nunca vive solo en el navegador.
test('el servidor exige confirmar:true y el nombre exacto de la subcuenta', () => {
  const route = sinComentarios(read(ROUTE))
  const archivar = route.slice(route.indexOf("'archivar'"), route.indexOf("'restaurar'"))
  assert.match(archivar, /body\.confirmar !== true/, 'falta el check de confirmación explícita')
  assert.match(
    archivar,
    /nombre !== fila\.name\.trim\(\) && nombre !== fila\.slug\.trim\(\)/,
    'el nombre se compara contra el nombre visible Y el slug (el slug es el UUID, imposible de recordar)'
  )
  // La comparación es EXACTA, no contains: "sucursal" no debe validar "sucursal 2".
  assert.doesNotMatch(archivar, /includes\(nombre\)/)
})

// El estado previo se lee ANTES del cambio para auditar old→new: un archivado sin registro del
// estado anterior no se puede defender ante una reclamación (¿estaba activa o ya suspendida?).
test('el archivado se audita con el estado anterior y rechaza operaciones nulas', () => {
  const provision = sinComentarios(read(PROVISION))
  assert.match(provision, /old_values: \{ status: estadoAnterior \}/, 'auditoría old→new')
  assert.match(provision, /estadoAnterior === status/, 'no re-escribe el mismo estado')
  assert.match(provision, /ya_estaba/)
  assert.match(provision, /no_existe/)
})

// Suspender la subcuenta desde la que administras ya estaba prohibido; archivarla es aún más
// grave (ni siquiera sus rutas API responderían para restaurarla). La guarda cubre ambos.
test('no se puede suspender NI archivar la subcuenta propia', () => {
  const provision = sinComentarios(read(PROVISION))
  assert.match(
    provision,
    /status !== 'active' && tenantId === actor\.tenantId/,
    'la guarda de no_la_propia debe cubrir cualquier estado ≠ active'
  )
  assert.match(provision, /no_la_propia/)
})

// La única vía de vuelta de 'archived' es restaurar desde la pantalla de subcuentas (super admin).
// Ninguna otra ruta escribe 'active' a una subcuenta que no lo esté: se audita qué rutas tocan
// tenants.update y que todas cuelgan del gate de super admin.
test('restaurar pasa por el mismo gate de super admin y la misma operación', () => {
  const route = sinComentarios(read(ROUTE))
  const restaurar = route.slice(route.indexOf("'restaurar'"))
  assert.match(restaurar, /setTenantStatus\(sb, body\.tenantId, 'active', actor\)/)
  const patch = route.slice(route.indexOf('export async function PATCH'))
  const gateIdx = patch.indexOf('requireSuperAdmin(tenant)')
  const restaurarIdx = patch.indexOf("'restaurar'")
  assert.ok(gateIdx >= 0 && restaurarIdx > gateIdx, 'restaurar debe ir tras el gate de super admin')
})

// Las 3 vías de entrada SIN sesión que quedaban fuera del gate heredado (pixel, OAuth de Google,
// regeneración de códigos de tracking) ya no aceptan subcuentas inactivas.
test('las entradas sin sesión también bloquean subcuentas archivadas', () => {
  const pixel = read('app/api/track/[site]/route.ts')
  assert.match(pixel, /tenants!inner\(status\)/, 'el pixel debe filtrar por el estado del tenant dueño')
  assert.match(pixel, /eq\('tenants\.status', 'active'\)/)
  const oauth = sinComentarios(read('app/api/oauth/google/callback/route.ts'))
  assert.match(oauth, /\.eq\('status', 'active'\)/, 'el OAuth de Google no conecta subcuentas inactivas')
  const regen = sinComentarios(read('app/api/[tenant]/evergreen/admin/regenerate-tracking-codes/route.ts'))
  const caminoCron = regen.slice(regen.indexOf('} else {'))
  assert.match(caminoCron, /\.eq\('status', 'active'\)/, 'regenerar códigos no toca subcuentas inactivas')
})

// En el switcher del super admin una archivada solo confunde (su URL acaba en 404): no se lista.
test('el switcher no lista subcuentas archivadas', () => {
  const header = sinComentarios(read('components/os/Header.tsx'))
  assert.match(header, /\.neq\('status', 'archived'\)/)
})

// UI: el diálogo de archivado expone el impacto ANTES de permitir confirmar, y la lista separa las
// archivadas para que no queden enterradas.
test('la UI lee el impacto antes de confirmar y separa las archivadas', () => {
  const page = read(PAGE)
  assert.match(page, /impactoLeido/, 'exige reconocer el impacto')
  assert.match(page, /confirmarArchivado/, 'la confirmación pasa por el flujo del diálogo')
  assert.match(page, /Se conservan TODOS los datos/, 'el impacto dice qué se conserva')
  assert.match(page, /quedará bloqueada/, 'y qué se bloquea')
  assert.match(page, /action: 'restaurar'/, 'hay botón de restaurar')
  const sinComent = sinComentarios(page)
  assert.match(sinComent, /status === 'archived'/, 'las archivadas se pintan en su propia sección')
})
