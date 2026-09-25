import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { allowedPrefixesFor, PERMISSIONS } from '../lib/auth/permissions.ts'
import { isAllowedLocation } from '../lib/marketing-navigation.ts'

// AUDITORÍA F02 — ENDPOINTS PRIVILEGIADOS SIN AUTORIZACIÓN DE PANTALLA.
//
// Dos rutas consultaban con service-role o con `postgres` directo —los dos se saltan RLS— después
// de comprobar solo que quien llama PERTENECE a la subcuenta. Cualquier miembro, con el rol que
// fuera, podía pedir el funnel completo del negocio o las métricas de VSL con la lista de correos
// de quienes vieron el vídeo. Esconder la entrada del menú no protege una dirección que se puede
// escribir a mano.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

/** La misma decisión que toma el layout, y ahora también el endpoint. */
const puedeEntrar = (rol, ruta) => {
  const zonas = allowedPrefixesFor(rol)
  return !zonas || zonas.length === 0 || isAllowedLocation(zonas, ruta)
}

// ── LA REGLA ES LA DEL MENÚ, NO UNA LISTA NUEVA ──────────────────────────────────────────────

test('quien no entra a la pantalla tampoco puede pedir sus datos', () => {
  // Si estos dos dejaran de coincidir, la pantalla y su API discreparían sobre quién ve qué.
  for (const rol of ['closer', 'setter', 'cobros', 'gestoria', 'csm']) {
    assert.equal(puedeEntrar(rol, '/funnels'), false, `${rol} no debería llegar al funnel`)
  }
  for (const rol of ['admin', 'director', 'manager']) {
    assert.equal(puedeEntrar(rol, '/funnels'), true, `${rol} sí trabaja con el funnel`)
  }
  // El rol `marketing` TAMPOCO llega hoy: '/funnels' está en los prefijos del departamento, pero no
  // en la lista propia del rol. Se deja constancia en vez de ampliarlo por el camino: un arreglo de
  // seguridad no es el sitio para dar acceso nuevo a nadie.
  assert.equal(puedeEntrar('marketing', '/funnels'), false)
})

test('VSL: el editor de contenido entra, el equipo de ventas no', () => {
  assert.equal(puedeEntrar('editor', '/marketing/adquisicion/vsl'), true)
  assert.equal(puedeEntrar('marketing', '/marketing/adquisicion/vsl'), true)
  assert.equal(puedeEntrar('closer', '/marketing/adquisicion/vsl'), false)
  assert.equal(puedeEntrar('cobros', '/marketing/adquisicion/vsl'), false)
})

test('el liderazgo no queda restringido: es la convención de allowedPrefixesFor', () => {
  // `undefined` significa "sin zonas", no "ninguna zona". Confundirlo cerraría la app entera.
  assert.equal(allowedPrefixesFor('admin'), undefined)
  assert.equal(puedeEntrar('admin', '/loquesea'), true)
})

// ── DATOS PERSONALES: VER LA MÉTRICA NO ES VER A LA PERSONA ──────────────────────────────────

test('la lista de correos del VSL solo va a quien ya puede ver contactos', () => {
  // Un editor de contenido necesita saber dónde se cae el vídeo; no necesita los correos de quienes
  // lo vieron. La regla no se inventa aquí: es la misma que rige el CRM.
  assert.equal(PERMISSIONS.canViewContacts('editor'), false)
  assert.equal(PERMISSIONS.canViewContacts('marketing'), false)
  assert.equal(PERMISSIONS.canViewContacts('closer'), true)
  assert.equal(PERMISSIONS.canViewContacts('director'), true)
})

// ── EL CABLEADO ──────────────────────────────────────────────────────────────────────────────

test('las dos rutas privilegiadas piden acceso de pantalla, no solo pertenencia', () => {
  const funnels = leer('app/api/[tenant]/evergreen/funnels/route.ts')
  assert.match(funnels, /requirePantalla\(tenant, '\/funnels'\)/)
  assert.ok(!/requireTenant\(/.test(funnels), 'pertenecer a la subcuenta no basta cuando se usa service-role')

  const vsl = leer('app/api/[tenant]/evergreen/vsl/metrics/[slug]/route.ts')
  assert.match(vsl, /requirePantalla\(tenant, '\/marketing\/adquisicion\/vsl'\)/)
  assert.match(vsl, /leads: puedeVerPersonas \? leads : \[\]/)
  // La cifra se conserva: ocultar no puede parecer "no hay nadie".
  assert.match(vsl, /leadsOcultos/)
})

test('el guardián deniega por defecto y no se salta con un rol desconocido', () => {
  const guardia = leer('lib/auth/requirePantalla.ts')
  assert.match(guardia, /status: 403/)
  // Un rol nulo cae en uno restringido, no en liderazgo: el fallo por defecto es denegar.
  assert.match(guardia, /sesion\.role \?\? 'setter'/)
  assert.match(guardia, /allowedPrefixesFor\(/, 'la regla tiene que ser la del menú')
})

test('la pantalla de VSL explica que oculta personas en vez de enseñar un vacío', () => {
  const panel = leer('components/vsl/VslDashboard.tsx')
  assert.match(panel, /leadsOcultos/)
  assert.match(panel, /requiere acceso a/)
})
