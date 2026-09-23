import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { conector, manifest } from '../lib/conectores/meta/index.ts'
import { comprobarSaludMeta } from '../lib/meta/salud.ts'

// F2 — META SOBRE EL CONTRATO.
//
// Lo que se prueba aquí NO es la sincronización de Meta (ya tiene sus tests y sigue siendo el mismo
// código): es que el envoltorio no la haya cambiado, que el manifiesto no prometa de más y que la
// comprobación de salud viva en un solo sitio.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

test('el conector delega: no reimplementa la sincronización', () => {
  // Una segunda implementación "más limpia" produciría cifras distintas de las del cron sin que
  // nadie se entere, que es exactamente lo que la graduación de F2 prohíbe.
  const src = leer('lib/conectores/meta/index.ts')
  for (const fn of ['runMetaSync', 'runMetaDailySync', 'runMetaAdsSync', 'comprobarSaludMeta']) {
    assert.match(src, new RegExp(`\\b${fn}\\b`), `el conector debe llamar a ${fn}, no copiarlo`)
  }
  assert.ok(!/graph\.facebook\.com/.test(src), 'hablar con la Graph API es tarea de lib/meta/client.ts')
  assert.ok(!/\.from\(/.test(src), 'el conector no escribe en la base: eso lo hace lib/meta/sync.ts')
})

test('el backfill corre las tres pasadas en el orden que exige la dependencia', () => {
  // El diario y los anuncios enlazan contra el mapa de campañas que escribe la primera pasada. Con
  // otro orden, `campaign_daily` se quedaba vacía sin devolver ningún error.
  const src = leer('lib/conectores/meta/index.ts')
  const orden = ['runMetaSync(', 'runMetaDailySync(', 'runMetaAdsSync('].map((f) => src.indexOf(f))
  assert.ok(
    orden.every((i) => i > 0),
    'faltan pasadas en el backfill'
  )
  assert.deepEqual(
    orden,
    [...orden].sort((a, b) => a - b),
    'las campañas van primero: las otras dos dependen de ellas'
  )
})

test('el manifiesto no promete escribir en Meta ni recibir webhooks', () => {
  // Leer gasto es reversible; crear o pausar campañas de un cliente, no. Y Meta no empuja insights:
  // decir que sí dejaría al panel explicando una vía de entrada que no existe.
  assert.equal(manifest.capabilities.executeAction, undefined)
  assert.equal(manifest.capabilities.ingestWebhook, undefined)
  assert.equal(manifest.webhookPath, undefined)
  assert.equal(typeof conector.executeAction, 'undefined')
})

test('no declara sincronización incremental: Meta reescribe el pasado', () => {
  // El gasto y las conversiones de un día se ajustan durante días por la ventana de atribución. Un
  // cursor congelaría la primera cifra vista, que casi nunca es la definitiva.
  assert.ok(!manifest.syncModes.includes('incremental'))
  assert.equal(typeof conector.incrementalSync, 'undefined')
  assert.match(leer('lib/conectores/meta/index.ts'), /REESCRIBE el pasado/)
})

test('sin token, la salud dice "configuración pendiente", no "avería"', async () => {
  // Es el arreglo de S0.7 §3.5: 19 errores falsos en 14 días eran subcuentas que sencillamente no
  // usan Meta. Sin red: la función corta antes de llamar a nadie.
  const v = await comprobarSaludMeta({})
  assert.equal(v.ok, false)
  assert.equal(v.code, 'sin_credenciales')
})

test('la comprobación de Meta existe una sola vez', () => {
  // La pantalla de Integraciones y el conector tienen que dar el MISMO veredicto sobre la misma
  // credencial. Dos comprobaciones acaban discrepando y nadie sabe cuál creer.
  const ruta = 'app/api/[tenant]/evergreen/settings/integraciones/route.ts'
  const src = leer(ruta)
  assert.match(src, /comprobarSaludMeta\(cfg\)/, 'la pantalla debe delegar en lib/meta/salud.ts')
  // Instagram sigue firmando aquí con el mismo helper, y eso está bien: es otro proveedor. Lo que
  // no puede quedar es una segunda comprobación de las CUENTAS PUBLICITARIAS.
  assert.ok(!/me\/adaccounts/.test(src), 'listar cuentas publicitarias es tarea de lib/meta/salud.ts')
})
