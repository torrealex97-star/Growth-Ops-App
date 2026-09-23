// Regresión de la normalización de `contacts.lead_channel` (2026-09-23).
// La migración fija en producción: forma canónica (trim + espacios + minúsculas),
// trigger que normaliza al vuelo y CHECK que impide persistir variantes no canónicas.
// Verificado en vivo contra producción (probe INSERT normalizada); aquí se fija por
// fuente (patrón del repo) para que borrar la migración no pase desapercibido en CI.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const aqui = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(
  join(aqui, '..', 'supabase', 'migrations', '20260923100000_contacts_lead_channel_normalize.sql'),
  'utf8'
)

test('la migración define la función canónica IMMUTABLE', () => {
  assert.match(sql, /create or replace function public\.contacts_normalize_lead_channel/)
  assert.match(sql, /immutable/)
  // Forma canónica: trim + colapsar espacios + minúsculas, vacío → NULL
  assert.match(sql, /regexp_replace\(p_valor, '\\s\+', ' ', 'g'\)/)
  assert.match(sql, /lower\(btrim\(/)
  assert.match(sql, /nullif\(/)
})

test('la migración normaliza los datos existentes', () => {
  assert.match(
    sql,
    /update public\.contacts\s+set lead_channel = public\.contacts_normalize_lead_channel\(lead_channel\)/
  )
})

test('el trigger normaliza al vuelo en INSERT y UPDATE', () => {
  assert.match(sql, /create trigger contacts_normalize_lead_channel_trg/)
  assert.match(sql, /before insert or update of lead_channel on public\.contacts/)
  assert.match(sql, /new\.lead_channel := public\.contacts_normalize_lead_channel\(new\.lead_channel\)/)
})

test('el CHECK impide persistir variantes no canónicas', () => {
  assert.match(sql, /add constraint contacts_lead_channel_canonical_chk/)
  assert.match(sql, /lead_channel is null\s+or lead_channel = public\.contacts_normalize_lead_channel\(lead_channel\)/)
})

// Semántica de la función SQL, replicada congelada (mismo patrón que otros tests del repo):
const normalizar = (v) => {
  if (v === null) return null
  const canon = v.trim().replace(/\s+/g, ' ').toLowerCase()
  return canon === '' ? null : canon
}

test('semántica: variantes de caso/espacios colapsan al mismo valor', () => {
  assert.equal(normalizar('Formulario VSL - Automaticamente'), 'formulario vsl - automaticamente')
  assert.equal(normalizar('  formulario   VSL - Automaticamente '), 'formulario vsl - automaticamente')
  assert.equal(normalizar('Calendly'), 'calendly')
  assert.equal(normalizar('CAL ENDLY'), 'cal endly')
  assert.equal(normalizar('   '), null)
  assert.equal(normalizar(null), null)
  // Conceptos distintos siguen siendo conceptos distintos (no es un enum):
  assert.notEqual(normalizar('llamada estratégica'), normalizar('llamada | women digital closers'))
})
