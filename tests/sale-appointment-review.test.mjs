import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync('app/[tenant]/ventas/registro/[id]/page.tsx', 'utf8')
const route = readFileSync('app/api/[tenant]/evergreen/sales/update/route.ts', 'utf8')

test('la edición permite revisar el vínculo con una agenda del mismo contacto', () => {
  assert.match(page, /Agenda que originó la venta/)
  assert.match(page, /\.eq\('contact_id', saleData\.contact_id\)/)
  assert.match(page, /appointment_id: editForm\.appointment_id/)
  assert.match(page, /Solo aparecen agendas del mismo contacto/)
})

test('el servidor bloquea agendas de otra subcuenta o contacto y audita el vínculo anterior', () => {
  assert.match(route, /\.eq\('tenant_id', t\.tenantId\)/)
  assert.match(route, /appointment\.contact_id !== prev\.contact_id/)
  assert.match(route, /La agenda pertenece a otro contacto/)
  assert.match(route, /appointment_id: prev\.appointment_id/)
})
