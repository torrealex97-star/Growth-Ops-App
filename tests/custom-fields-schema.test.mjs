import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

const migration = read('supabase/migrations/20260921200000_contact_custom_fields.sql')
const route = read('app/api/[tenant]/evergreen/contacts/[id]/route.ts')
const page = read('app/[tenant]/crm/contactos/[id]/page.tsx')
const types = read('lib/types/database.ts')

test('custom fields usa el esquema canónico y no columnas inventadas', () => {
  assert.match(migration, /field_key TEXT NOT NULL/)
  assert.match(migration, /field_type TEXT NOT NULL DEFAULT 'text'/)
  assert.match(migration, /ALTER TABLE public\.contacts ADD COLUMN IF NOT EXISTS custom_fields JSONB/)
  assert.doesNotMatch(migration, /options JSONB|active BOOLEAN/)
  assert.match(types, /field_key: string[\s\S]*field_type: 'text' \| 'number' \| 'date' \| 'boolean'/)
})

test('API y ficha acotan definiciones y contactos a la subcuenta', () => {
  assert.match(route, /\.from\('custom_field_defs'\)[\s\S]*\.eq\('tenant_id', t\.tenantId\)/)
  assert.match(route, /\.from\('contacts'\)[\s\S]*\.eq\('tenant_id', t\.tenantId\)/)
  assert.match(route, /\.from\('contacts'\)\.update\(patch\)\.eq\('id', id\)\.eq\('tenant_id', t\.tenantId\)/)
  assert.match(page, /\.from\('custom_field_defs'\)[\s\S]*\.eq\('tenant_id', tenantId\)/)
  assert.match(page, /\.from\('contracts'\)[\s\S]*\.eq\('tenant_id', tenantId\)/)
})

test('null y cadena vacía eliminan el valor sin aceptar tipos inválidos', () => {
  assert.match(route, /raw === null \|\| raw === ''/)
  assert.match(route, /delete merged\[fieldId\]/)
  assert.match(route, /typeof raw === 'number' && Number\.isFinite\(raw\)/)
  assert.match(route, /typeof raw === 'boolean'/)
  assert.match(route, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/)
})
