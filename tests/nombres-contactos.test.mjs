import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mejorNombre, esNombreHueco } from '../lib/contacts/resolve.ts'

// REGRESIÓN — nombres de contactos en minúsculas (4-oct).
//
// Las plataformas devuelven muchos nombres todo en minúsculas aunque en SU interfaz se vean
// capitalizados, y los arreglos hechos en la plataforma no se propagaban: el webhook GHL solo
// rellenaba el nombre si estaba vacío y la re-ingesta (citas-sync) rebajaba "Maria Garcia" a
// "maria garcia". Reglas en lib/contacts/resolve.ts (mejorNombre) y lib/utils.ts (capitalizeName).

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

test('el hueco ("Sin nombre" o vacío) nunca pisa un nombre real', () => {
  assert.equal(esNombreHueco(null), true)
  assert.equal(esNombreHueco('   '), true)
  assert.equal(esNombreHueco('Sin nombre'), true)
  assert.equal(esNombreHueco('SIN NOMBRE'), true)
  assert.equal(esNombreHueco('Maria Garcia'), false)
  assert.equal(mejorNombre('Maria Garcia', 'Sin nombre'), 'Maria Garcia')
  assert.equal(mejorNombre('Maria Garcia', ''), 'Maria Garcia')
  assert.equal(mejorNombre('Maria Garcia', null), 'Maria Garcia')
  assert.equal(mejorNombre(null, 'Maria Garcia'), 'Maria Garcia')
})

test('la grafía mejor escrita del mismo nombre gana, en ambos sentidos', () => {
  assert.equal(mejorNombre('maria garcia', 'Maria Garcia'), 'Maria Garcia')
  assert.equal(mejorNombre('Maria Garcia', 'maria garcia'), 'Maria Garcia')
  assert.equal(mejorNombre('MARIA GARCIA', 'Maria Garcia'), 'MARIA GARCIA')
  // idénticas → da igual (idempotente, sin reescrituras infinitas)
  assert.equal(mejorNombre('Maria Garcia', 'Maria Garcia'), 'Maria Garcia')
  // acentos y eñes cuentan como mayúscula/minúscula
  assert.equal(mejorNombre('josé muñoz', 'José Muñoz'), 'José Muñoz')
})

test('un nombre distinto lo manda la plataforma (se conserva el comportamiento anterior)', () => {
  assert.equal(mejorNombre('Maria Garcia', 'Maria Jose Garcia Lopez'), 'Maria Jose Garcia Lopez')
  assert.equal(mejorNombre('Maria Garcia', 'maria j g'), 'maria j g')
})

test('la bandeja ofrece "reserva" y el resolve registra el anticipo tal cual se recibió', () => {
  const ui = read('components/sales/PaymentInbox.tsx')
  assert.ok(ui.includes('value="reservation"'), 'el selector debe ofrecer registrar como reserva')
  assert.ok(
    ui.includes('grossAmount: Number(detail.payment.amount)'),
    'la reserva se registra por el anticipo recibido, no por un importe tecleado'
  )
  const resolve = read('app/api/[tenant]/evergreen/sales/payment-inbox/resolve/route.ts')
  assert.ok(
    !resolve.includes('Las reservas y la financiación externa se completan'),
    'desaparece el bloqueo global de planes reserva en la bandeja'
  )
  assert.ok(resolve.includes('La financiación externa (Sequra)'), 'Sequra sigue bloqueado en la bandeja')
  assert.ok(
    resolve.includes('Math.abs(body.grossAmount - amount) > 0.01'),
    'una reserva exige total pactado == cobro recibido'
  )
})

test('al completar una reserva no se ofrece el plan de reserva como plan final', () => {
  const nueva = read('app/[tenant]/ventas/registro/nueva/page.tsx')
  assert.ok(
    nueva.includes(".filter((plan) => !reservationId || plan.method !== 'reserva')"),
    'el plan de reserva no puede ser el plan final de una conversión'
  )
  assert.ok(
    nueva.includes('readOnly={!!reservationId}'),
    'el importe de reserva es readonly al completar: el RPC exige reservation_amount == gross de la reserva'
  )
})

test('capitalizeName vive en lib/utils y se usa en bandeja, reservas y CRM sin duplicarse', () => {
  assert.ok(read('lib/utils.ts').includes('export function capitalizeName'))
  assert.ok(read('components/sales/PaymentInbox.tsx').includes('capitalizeName'))
  assert.ok(read('app/[tenant]/ventas/reservas/page.tsx').includes('capitalizeName'))
  const crm = read('components/crm/ContactsAllView.tsx')
  assert.ok(!crm.includes('function capitalizeName'), 'no hay copia local del helper')
  assert.ok(crm.includes("from '@/lib/utils'"))
})

test('la ingesta adopta la mejor grafía del mismo nombre (citas-sync y webhook GHL)', () => {
  const sync = read('lib/integrations/citas-sync.ts')
  assert.ok(sync.includes('mejorNombre(row?.full_name, fullName)'), 'citas-sync usa mejorNombre')
  const webhook = read('app/api/[tenant]/evergreen/webhooks/ghl/route.ts')
  assert.ok(
    webhook.includes('mejorNombre(contact.full_name, fullName)'),
    'el webhook GHL propaga los arreglos de mayúsculas hechos en GHL'
  )
})
