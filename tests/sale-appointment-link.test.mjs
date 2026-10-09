import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseSaleAppointment } from '../lib/sales/appointment-link.ts'

const appointment = (id, status) => ({ id, status, appointment_datetime: '2026-09-01T10:00:00Z' })

test('elige el único show aunque haya otras citas no asistidas', () => {
  assert.equal(chooseSaleAppointment([appointment('cancelled', 'cancelled'), appointment('shown', 'show')]), 'shown')
})

test('no elige entre varios shows', () => {
  assert.equal(chooseSaleAppointment([appointment('a', 'show'), appointment('b', 'attended')]), null)
})

test('sin show solo enlaza una candidata inequívoca', () => {
  assert.equal(chooseSaleAppointment([appointment('only', 'scheduled')]), 'only')
  assert.equal(chooseSaleAppointment([appointment('a', 'scheduled'), appointment('b', 'cancelled')]), null)
})

test('sin candidatas no inventa vínculo', () => {
  assert.equal(chooseSaleAppointment([]), null)
})
