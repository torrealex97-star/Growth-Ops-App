import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// S0.7 — EL SECRETO DE UN WEBHOOK ES DE SU SUBCUENTA, Y SIN SECRETO NO SE ENTRA.
//
// Dos fallos de la misma familia, encontrados en el baseline de integraciones:
//
//   · Calendly pedía su "Webhook Signing Key" por subcuenta en Integraciones y la guardaba cifrada,
//     pero el webhook validaba contra la variable de entorno GLOBAL. La clave de cada cliente se
//     ignoraba y todos compartían secreto: con un secreto compartido, el webhook de un cliente puede
//     escribir en los datos de otro. GHL tuvo este mismo fallo (#127).
//   · Apify solo comprobaba el secreto SI había secreto configurado. Sin él, cualquiera podía
//     publicar contenido social en la base.
//
// Estos tests atan las dos propiedades en todos los webhooks entrantes, para que un endpoint nuevo
// no las reabra.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

const calendly = leer('app/api/[tenant]/evergreen/webhooks/calendly/route.ts')
const apify = leer('app/api/webhooks/apify/route.ts')

test('Calendly valida con el secreto de la subcuenta, no solo con el global', () => {
  assert.match(calendly, /cfg\.CALENDLY_WEBHOOK_SECRET \|\| process\.env\.CALENDLY_WEBHOOK_SECRET/)
  // La variable de entorno sigue como respaldo, pero nunca como única fuente.
  assert.doesNotMatch(calendly, /const secret = process\.env\.CALENDLY_WEBHOOK_SECRET/)
})

test('Calendly resuelve la subcuenta ANTES de comprobar la firma', () => {
  // Sin esto no se puede saber qué secreto toca. El orden es la esencia del arreglo.
  // Se compara contra la LLAMADA (`verifySignature(raw,`), no contra su definición más arriba.
  assert.ok(calendly.indexOf("from('tenants')") < calendly.indexOf('verifySignature(raw,'))
})

test('una subcuenta que no existe responde igual que una firma inválida', () => {
  // Si respondiera 404, el endpoint serviría para averiguar qué subcuentas existen.
  const trozo = calendly.slice(calendly.indexOf('if (!tenantRow)'), calendly.indexOf('const cfg ='))
  assert.match(trozo, /Firma inválida.*401/s)
})

test('Apify rechaza cuando no hay secreto configurado', () => {
  const chequeo = apify.indexOf('if (!secret)')
  assert.ok(chequeo > -1, 'falta el rechazo sin secreto')
  assert.match(apify.slice(chequeo, chequeo + 260), /status: 401/)
  // Y el rechazo va antes de tocar nada de la base.
  assert.ok(chequeo < apify.indexOf('.from('))
})

test('ningún webhook entrante se queda sin comprobación de secreto', () => {
  // Lista cerrada: un webhook nuevo sin verificación rompe el test en vez de pasar desapercibido.
  const rutas = [
    'app/api/[tenant]/evergreen/webhooks/calendly/route.ts',
    'app/api/[tenant]/evergreen/webhooks/ghl/route.ts',
    'app/api/[tenant]/evergreen/webhooks/stripe/route.ts',
    'app/api/webhooks/apify/route.ts',
    'app/api/webhooks/resend/route.ts',
  ]
  for (const ruta of rutas) {
    const src = leer(ruta)
    assert.match(
      src,
      /verifySignature|verificarFirmaStripe|isValidWebhookSecret|svix-signature|APIFY_WEBHOOK_SECRET/,
      `${ruta}: no se ve ninguna verificación de firma o secreto`
    )
    assert.match(src, /401/, `${ruta}: tiene que poder rechazar`)
  }
})
