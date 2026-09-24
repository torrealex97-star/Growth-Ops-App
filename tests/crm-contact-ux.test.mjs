import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('el drawer prioriza la ficha del contacto y conserva enlaces navegables', () => {
  const src = read('app/[tenant]/crm/agendas/page.tsx')
  assert.match(src, /text-2xl font-semibold/)
  assert.match(src, /crm\/contactos\/\$\{selectedAppointment\.contact_id\}/)
  assert.match(src, /selectedAppointment\.contacts\.email/)
})

test('el payload crudo se ha retirado de la ficha (ya no hay nada que ocultar)', () => {
  const src = read('components/appointments/AppointmentDetail.tsx')
  assert.doesNotMatch(src, /rawPayloadVisible|Payload crudo del webhook/)
  assert.doesNotMatch(src, /canSeeRawPayload/)
})

test('el deshacer persistido usa versión y no intercepta undo nativo', () => {
  const contactRoute = read('app/api/[tenant]/evergreen/contacts/[id]/route.ts')
  const appointmentRoute = read('app/api/[tenant]/evergreen/appointments/update/route.ts')
  const contactPage = read('app/[tenant]/crm/contactos/[id]/page.tsx')
  const detail = read('components/appointments/AppointmentDetail.tsx')
  assert.match(contactRoute, /expectedUpdatedAt/)
  assert.match(appointmentRoute, /expectedUpdatedAt/)
  assert.match(contactPage, /label: 'Deshacer'/)
  assert.match(detail, /label: 'Deshacer'/)
  assert.doesNotMatch(`${contactPage}\n${detail}`, /onKeyDown=.*preventDefault/)
})

test('la timeline incluye actividades y contratos sin crear una tabla de mensajes', () => {
  const timeline = read('lib/contact-timeline.ts')
  const page = read('app/[tenant]/crm/contactos/[id]/page.tsx')
  // Contrato de la timeline (22-sep): trazabilidad completa del contacto — además de
  // actividades y contratos, pagos recibidos, impagos, eventos CSM y feedback del formulario.
  assert.match(timeline, /type TimelineEventType =\s[\s\S]*'activity'[\s\S]*'contract'/)
  assert.match(timeline, /'payment'/)
  assert.match(timeline, /'delinquency'/)
  assert.match(timeline, /'csm'/)
  assert.match(timeline, /'feedback'/)
  assert.match(page, /\.from\('activities'\)/)
  assert.match(page, /\.from\('contracts'\)/)
  assert.match(page, /\.from\('csm_events'\)/)
})
