import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// La reparación de comisiones rehace TODAS las no liquidadas de la subcuenta. Para cuadrar unos pocos
// cobros registrados por fuera (el backfill de Stripe de S0.4) eso es demasiado: resetea a "pendiente"
// comisiones ya aprobadas de ventas que nadie ha tocado. De ahí el alcance por venta.

const ruta = readFileSync(
  new URL('../app/api/[tenant]/evergreen/sales/reconcile-all/route.ts', import.meta.url),
  'utf8'
)
const wf = readFileSync(new URL('../.github/workflows/reparar-comisiones.yml', import.meta.url), 'utf8')

test('con saleIds solo se reconcilian esas ventas, y dentro de la subcuenta', () => {
  assert.match(ruta, /if \(saleIds\) query = query\.in\('id', saleIds\)/)
  // El filtro de subcuenta va SIEMPRE, también con lista: un id ajeno no se cuela con service_role.
  assert.ok(ruta.indexOf(".eq('tenant_id', tenantId)") < ruta.indexOf(".in('id', saleIds)"))
})

test('un id que no es de la subcuenta se rechaza con nombre, no se ignora', () => {
  assert.match(ruta, /rows\.length !== saleIds\.length/)
  assert.match(ruta, /faltan:/)
})

test('sin lista, el botón de Comisiones sigue haciendo la reparación completa', () => {
  // La pantalla llama sin cuerpo: req.json() falla y el alcance es la subcuenta, como antes.
  assert.match(ruta, /req\.json\(\)\.catch\(\(\) => \(\{\}\)\)/)
  assert.match(ruta, /alcance: saleIds \? 'ventas' : 'subcuenta'/)
})

test('el workflow manual envía la lista y valida el slug antes de montar la URL', () => {
  assert.match(wf, /workflow_dispatch/)
  assert.match(wf, /saleIds:/)
  assert.match(wf, /\^\[a-z0-9-\]\+\$/)
  assert.doesNotMatch(wf, /schedule:/, 'no es un cron: se lanza a mano')
})
