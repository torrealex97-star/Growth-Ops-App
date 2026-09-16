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

test('el payload crudo se oculta cuando existe una llamada procesada', () => {
  const src = read('components/appointments/AppointmentDetail.tsx')
  assert.match(src, /appointment\.fathom_meeting_id/)
  assert.match(src, /appointment\.transcript/)
  assert.match(src, /appointment\.ai_analyzed_at/)
  assert.match(src, /!\\([\s\S]*appointment\.fathom_meeting_id/)
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
  assert.match(timeline, /type TimelineEventType = .*activity.*contract/)
  assert.match(page, /\.from\('activities'\)/)
  assert.match(page, /\.from\('contracts'\)/)
})
