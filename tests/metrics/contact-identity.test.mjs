import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const IDENTIDADES = '../../supabase/migrations/20260914130000_contacts_identity_uniques.sql'
const UNICO_EMAIL = '../../supabase/migrations/20260914160000_contacts_email_unique.sql'

test('la normalización de identidad vive en columnas generadas, no en TypeScript', () => {
  const sql = read(IDENTIDADES)
  // Una sola definición de "mismo email" / "mismo teléfono", en la base de datos: así el encaje de
  // los webhooks, el UNIQUE y la pantalla de fusión no pueden discrepar entre sí.
  assert.match(
    sql,
    /email_normalized text\s*\n?\s*GENERATED ALWAYS AS \(NULLIF\(lower\(btrim\(email\)\), ''\)\) STORED/
  )
  assert.match(sql, /phone_normalized text[\s\S]*regexp_replace\(phone, '\[\^0-9\]', '', 'g'\)/)
  assert.match(sql, /contacts \(tenant_id, email_normalized\)/)
  assert.match(sql, /contacts \(tenant_id, phone_normalized\)/)
})

test('no hay UNIQUE sobre el teléfono: un número compartido es legítimo', () => {
  const ejecutable = read(IDENTIDADES)
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
  // Una pareja, una familia apuntando a dos niños o el fijo de una empresa comparten número. Un
  // UNIQUE ahí rechazaría contactos reales.
  assert.ok(!/UNIQUE/i.test(ejecutable), 'esta migración no debe crear ningún UNIQUE')
})

test('el UNIQUE de email va aparte, es parcial y dice qué fusionar si no puede crearse', () => {
  const sql = read(UNICO_EMAIL)
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_email_normalized_key/)
  assert.match(sql, /WHERE email_normalized IS NOT NULL AND merged_into IS NULL/)
  // Si el histórico tiene duplicados, falla nombrándolos — no fusiona nada por su cuenta: elegir el
  // contacto primario es una decisión sobre datos del usuario.
  assert.match(sql, /RAISE EXCEPTION 'Hay contactos que comparten email/)
  assert.match(sql, /Data Health/)
  assert.ok(!/merge_contacts|UPDATE public\.contacts/i.test(sql), 'una migración no debe fusionar contactos sola')
})

test('Calendly y GHL resuelven el contacto por la función atómica compartida', () => {
  for (const route of ['webhooks/calendly', 'webhooks/ghl']) {
    const code = read(`../../app/api/[tenant]/evergreen/${route}/route.ts`)
    assert.match(code, /getOrCreateContact\(sb, tenantId, \{/)
  }
  const lib = read('../../lib/contacts/resolve.ts')
  assert.match(lib, /\.rpc\('contacts_get_or_create'/)
})

test('el encaje de la función usa las columnas normalizadas, para caer en sus índices', () => {
  const sql = read('../../supabase/migrations/20260914150000_contacts_get_or_create.sql')
  assert.match(sql, /c\.email_normalized = v_email/)
  assert.match(sql, /c\.phone_normalized = v_phone/)
  // Y las variables se calculan con la MISMA expresión que las columnas generadas.
  assert.match(sql, /v_email TEXT := NULLIF\(lower\(btrim\(coalesce\(p_email, ''\)\)\), ''\);/)
  assert.match(sql, /v_phone TEXT := NULLIF\(regexp_replace\(coalesce\(p_phone, ''\), '\[\^0-9\]', '', 'g'\), ''\);/)
})
