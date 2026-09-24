import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { INTEGRATION_GROUPS } from '../lib/integrations-catalog.ts'

// LA GUÍA DE INTEGRACIONES NO PUEDE MENTIR.
//
// Configurar una integración no es "rellenar campos": es ir a buscar valores a otro producto. Sin
// decir dónde está cada uno, hace falta alguien técnico delante. Y si además hay que montar a mano
// la URL de un webhook, aparece la errata que cuesta una tarde encontrar — ya pasó con GHL.
//
// El riesgo de una guía es que se quede vieja y mande a la gente a un sitio equivocado con mucha
// seguridad. Estos tests atan lo que se puede comprobar: que la URL que se enseña exista de verdad,
// y que los pasos cubran los campos obligatorios.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const grupo = (id) => INTEGRATION_GROUPS.find((g) => g.id === id)

test('la dirección de webhook que se enseña corresponde a una ruta que existe', () => {
  // Si alguien mueve o renombra la ruta, la guía seguiría dictando la vieja con total aplomo.
  const conWebhook = INTEGRATION_GROUPS.filter((g) => g.webhookPath)
  assert.ok(conWebhook.length > 0, 'al menos GHL debe declarar su webhook')
  for (const g of conWebhook) {
    // Hay dos formas legítimas: por subcuenta (`/api/{tenant}/…`, la normal) y de plataforma
    // (`/api/webhooks/…`), para proveedores que no distinguen clientes, como Apify.
    assert.match(g.webhookPath, /^\/api\/(\{tenant\}|webhooks)\//, `${g.id}: ruta de webhook con forma rara`)
    const fichero = join(root, 'app', g.webhookPath.replace('{tenant}', '[tenant]'), 'route.ts')
    assert.ok(existsSync(fichero), `${g.id}: la guía apunta a ${g.webhookPath}, que no existe`)
  }
})

test('GHL trae guía completa: pasos numerados y su webhook', () => {
  const ghl = grupo('ghl')
  assert.ok(ghl.pasos?.length >= 5, 'la puesta en marcha de GHL son varios sitios distintos')
  assert.equal(ghl.webhookPath, '/api/{tenant}/evergreen/webhooks/ghl')
})

test('cada credencial obligatoria de GHL está cubierta por algún paso', () => {
  // Un campo obligatorio sin paso es exactamente el agujero que dejó a GHL sin funcionar: la app
  // pedía el secreto del webhook y nadie explicaba de dónde salía ni dónde más había que ponerlo.
  const ghl = grupo('ghl')
  const guia = ghl.pasos
    .map((p) => `${p.titulo} ${p.detalle}`)
    .join(' ')
    .toLowerCase()
  const cubierto = {
    GHL_LOCATION_ID: 'location id',
    GHL_API_TOKEN: 'integraciones privadas',
    GHL_WEBHOOK_SECRET: 'x-ghl-secret',
  }
  for (const clave of ghl.required) {
    assert.ok(guia.includes(cubierto[clave]), `${clave} no se explica en ningún paso`)
  }
})

test('los pasos dicen de dónde sale el dato, no solo qué campo rellenar', () => {
  for (const paso of grupo('ghl').pasos) {
    assert.ok(paso.detalle.length > 80, `"${paso.titulo}": un detalle corto no saca a nadie del atasco`)
  }
})

test('se avisa de que el secreto lo elige el usuario y debe coincidir en los dos sitios', () => {
  // Los dos malentendidos que de verdad bloquean: creer que GHL da ese valor, y pegarlo con un
  // espacio de más. La comparación es byte a byte.
  const guia = grupo('ghl')
    .pasos.map((p) => p.detalle)
    .join(' ')
  assert.match(guia, /no la da GHL|la eliges tú/i)
  assert.match(guia, /EXACTAMENTE|idéntic/i)
})

test('el panel pinta la guía y resuelve la subcuenta en la dirección', () => {
  const page = readFileSync(join(root, 'app/[tenant]/settings/integraciones/page.tsx'), 'utf8')
  assert.match(page, /<GuiaIntegracion grupo=\{g\} tenant=\{tenant\} \/>/)
  assert.match(page, /replace\('\{tenant\}', tenant\)/, 'la URL se enseña ya montada, no como plantilla')
  // Sin portapapeles no se puede dejar a nadie bloqueado: el texto tiene que seguir a la vista.
  assert.match(page, /selecciónala y cópiala a mano/)
})

// ── COBERTURA: NINGUNA INTEGRACIÓN NUEVA SIN GUÍA ────────────────────────────────────────────

// Quedan sin guía a propósito, no por olvido: son proveedores cuyo panel no conocemos lo bastante
// como para dictar pasos, y una guía inventada es peor que ninguna — manda a alguien a un sitio
// equivocado con total seguridad. Cuando se configure uno de verdad, se escribe su guía y sale de
// aquí. La lista es CERRADA: añadir una integración nueva sin pasos rompe el test.
const SIN_GUIA_TODAVIA = new Set(['tiktok', 'sequra', 'creatuagente', 'hotmart', 'whop', 'skool'])

test('toda integración tiene guía, salvo las declaradas como pendientes', () => {
  const sinGuia = INTEGRATION_GROUPS.filter(
    (g) => g.surface !== 'empresa' && !g.pasos?.length && !SIN_GUIA_TODAVIA.has(g.id)
  ).map((g) => g.id)
  assert.deepEqual(sinGuia, [], `integraciones sin paso a paso: ${sinGuia.join(', ')}`)
})

test('la lista de pendientes no se queda obsoleta', () => {
  // Si alguien escribe la guía de una pendiente y olvida sacarla de la lista, el test lo dice: así
  // la lista mide lo que falta de verdad y no se convierte en decoración.
  for (const id of SIN_GUIA_TODAVIA) {
    const g = INTEGRATION_GROUPS.find((x) => x.id === id)
    assert.ok(g, `"${id}" está en pendientes pero ya no existe en el catálogo`)
    assert.ok(!g.pasos?.length, `"${id}" ya tiene guía: quítala de SIN_GUIA_TODAVIA`)
  }
})

test('las guías escritas cumplen el mínimo de utilidad', () => {
  // Un paso de una línea ("pon la API key") no saca a nadie del atasco: el valor está en decir
  // DÓNDE se consigue y qué suele salir mal.
  for (const g of INTEGRATION_GROUPS.filter((x) => x.pasos?.length)) {
    assert.ok(g.pasos.length >= 2, `${g.id}: una integración no se configura en un solo paso`)
    for (const paso of g.pasos) {
      assert.ok(paso.titulo?.length > 10, `${g.id}: un paso sin título utilizable`)
      assert.ok(paso.detalle?.length > 80, `${g.id} · "${paso.titulo}": el detalle es demasiado corto`)
    }
  }
})

test('las integraciones con webhook entrante enseñan su dirección', () => {
  // Componer la URL a mano es donde se coló la errata que dejó GHL sin funcionar una semana.
  for (const id of ['ghl', 'calendly', 'stripe']) {
    const g = INTEGRATION_GROUPS.find((x) => x.id === id)
    assert.ok(g.webhookPath, `${id} recibe webhooks: su dirección tiene que estar a la vista`)
  }
})
