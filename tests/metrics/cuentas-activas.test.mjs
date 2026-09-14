import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const ruta = read('../../app/api/[tenant]/evergreen/integraciones/cuentas-activas/route.ts')
const hook = read('../../lib/meta/use-cuentas-activas.ts')
const pantalla = read('../../app/[tenant]/unit-economics/page.tsx')

test('la selección de cuentas se sirve sin exponer credenciales', () => {
  // La configuración de la subcuenta lleva el token al lado del id de cuenta. Este endpoint devuelve
  // SOLO los identificadores.
  assert.match(ruta, /parseAccountIds\(cfg\.META_AD_ACCOUNT_ID\)/)
  for (const secreto of ['META_ACCESS_TOKEN', 'META_APP_SECRET', 'STRIPE_SECRET_KEY']) {
    assert.ok(!ruta.includes(secreto), `el endpoint no debe tocar ${secreto}`)
  }
  assert.match(ruta, /await requireTenant\(tenant\)/)
})

test('vacío significa TODAS, el mismo convenio que la sincronización', () => {
  // Si aquí significara otra cosa, el panel de Integraciones y los datos discreparían.
  assert.match(ruta, /todas: meta\.length === 0/)
  assert.match(hook, /const todas = datos\?\.meta\.todas \?\? true/)
})

test('mientras carga no se filtra: un cero prematuro se lee como un dato', () => {
  // Pintar 0 en el primer render sería peor que pintar de más un instante, porque la gente toma
  // decisiones con lo que ve.
  assert.match(hook, /if \(todas \|\| !datos\) return filas/)
  assert.match(hook, /if \(todas \|\| !datos\) return true/)
})

test('una campaña sin cuenta (manual) nunca se descarta', () => {
  assert.match(hook, /if \(!accountId\) return true/)
  assert.match(hook, /filas\.filter\(\(f\) => !f\.account_id \|\| permitidas\.has\(f\.account_id\)\)/)
})

test('Métricas y KPIs filtra por cuenta seleccionada y tiene filtro de periodo', () => {
  // La pantalla sumaba las CATORCE cuentas que ve el token y lo presentaba como el negocio.
  assert.match(pantalla, /useCuentasMetaActivas\(tenant\)/)
  assert.match(pantalla, /const campaignsVisibles = useMemo\(\(\) => cuentas\.filtrar\(campaigns\)/)
  // Y el filtro de periodo que faltaba, con la serie diaria que lo hace posible.
  assert.match(pantalla, /<PeriodFilterBar/)
  assert.match(pantalla, /from\('campaign_daily'\)/)
  // Los totales salen de lo filtrado, no de la lista cruda.
  assert.match(pantalla, /const totalAdspend = campanasParaTotales\.reduce/)
  assert.ok(
    !/const totalAdspend = campaigns\.reduce/.test(pantalla),
    'los totales no pueden salir de las campañas sin filtrar'
  )
})

test('con periodo mandan los datos diarios; sin periodo, el acumulado', () => {
  // Mezclarlos daría un gasto que no corresponde a ninguna de las dos cosas.
  assert.match(pantalla, /if \(!hayPeriodo\) return campaignsVisibles/)
  assert.match(pantalla, /acc\.spend \+= Number\(d\.spend \?\? 0\)/)
  // Y el aviso que decía que no se podía filtrar ya no está.
  assert.ok(!/esta pantalla no\s*\n?\s*filtra por mes\/periodo/.test(pantalla))
})
