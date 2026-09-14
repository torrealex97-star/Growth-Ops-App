import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { normalizeContactEmail, normalizeContactPhone } from '../../lib/contacts/upsert.ts'

test('normaliza email y teléfono sin mezclar tenants', () => {
  assert.equal(normalizeContactEmail('  Alex@Example.COM '), 'alex@example.com')
  assert.equal(normalizeContactEmail('   '), null)
  assert.equal(normalizeContactPhone('+34 612-345-678'), '34612345678')
  assert.equal(normalizeContactPhone(''), null)
})

test('la carrera de dos webhooks recupera la fila ganadora tras 23505', () => {
  const code = readFileSync(new URL('../../lib/contacts/upsert.ts', import.meta.url), 'utf8')
  assert.match(code, /inserted\.error\?\.code !== '23505'/)
  assert.match(code, /findByIdentity\(sb, tenantId, canonical, select\)/)
})

test('los uniques de contacto son normalizados, parciales y por subcuenta', () => {
  const sql = readFileSync(
    new URL('../../supabase/migrations/20260914130000_contacts_identity_uniques.sql', import.meta.url),
    'utf8'
  )
  assert.match(sql, /contacts \(tenant_id, email_normalized\)/)
  assert.match(sql, /contacts \(tenant_id, phone_normalized\)/)
  assert.match(sql, /WHERE email_normalized IS NOT NULL/)
  assert.match(sql, /WHERE phone_normalized IS NOT NULL/)
  assert.match(sql, /RAISE EXCEPTION 'Contactos duplicados por email normalizado/)
})

test('Calendly y GHL usan el guardado idempotente compartido', () => {
  for (const route of ['webhooks/calendly', 'webhooks/ghl']) {
    const code = readFileSync(new URL(`../../app/api/[tenant]/evergreen/${route}/route.ts`, import.meta.url), 'utf8')
    assert.match(code, /upsertContactByIdentity/)
  }
})
