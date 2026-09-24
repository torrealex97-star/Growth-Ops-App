// Canal de origen en el punto único de creación de contactos (2026-09-23).
// Fija: la migración añade p_lead_channel normalizado y elimina la firma antigua; resolve.ts
// acepta el canal; GHL estampa su `source`, Calendly estampa 'calendly'; y el canal SOLO viaja
// en la creación (first-touch) — la entrega sobre un contacto existente no lo toca.
// Patrón del repo: verificación por fuente de la migración/rutas + semántica pura replicada
// (la función SQL no es importable desde un test .mjs; el dry-run real verificó su comportamiento
// en la BD y este test congela el contrato para que ningún cambio lo rompa en silencio).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const leer = (p) => readFileSync(p, 'utf8')

test('la migración añade p_lead_channel normalizado y elimina la firma antigua', () => {
  const sql = leer('supabase/migrations/20260923120000_contacts_get_or_create_lead_channel.sql')
  assert.match(sql, /p_lead_channel TEXT DEFAULT NULL/)
  // La forma canónica la define la función IMMUTABLE de la normalización, no una copia local.
  assert.match(sql, /v_canal TEXT := public\.contacts_normalize_lead_channel\(p_lead_channel\)/)
  // El INSERT nuevo estampa el canal.
  assert.match(sql, /ghl_contact_id, instagram, age, lead_status, lead_channel, first_seen_at/)
  // Firma antigua eliminada: no queda sobrecarga muerta de 11 argumentos.
  assert.match(
    sql,
    /DROP FUNCTION IF EXISTS public\.contacts_get_or_create\(\s*UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INT, TEXT, TIMESTAMPTZ\s*\);/
  )
  // Grants: solo service_role (mismo reparto que la migración original).
  const grants = sql.split('GRANT EXECUTE')[1] ?? ''
  assert.ok(grants.includes('TO service_role;'))
  assert.ok(!/TO authenticated/.test(grants), 'ningún cliente de navegador llama a la función')
})

test('el canal solo viaja en la creación: first-touch, no last-touch', () => {
  const sql = leer('supabase/migrations/20260923120000_contacts_get_or_create_lead_channel.sql')
  // En la rama de contacto existente NO hay asignación de lead_channel.
  const ramaExistente = sql.slice(sql.indexOf('IF v_id IS NOT NULL THEN'), sql.indexOf('INSERT INTO public.contacts'))
  assert.match(ramaExistente, /merged_into INTO v_merged/)
  assert.ok(!/lead_channel\s*=/i.test(ramaExistente), 'sobreescribir el canal destruiría la atribución original')
})

test('resolve.ts acepta el canal y lo pasa a la función', () => {
  const lib = leer('lib/contacts/resolve.ts')
  assert.match(lib, /leadChannel\?: string \| null/)
  assert.match(lib, /p_lead_channel: identity\.leadChannel \?\? null/)
})

test('GHL estampa su source y Calendly estampa calendly', () => {
  const ghl = leer('app/api/[tenant]/evergreen/webhooks/ghl/route.ts')
  assert.match(ghl, /leadChannel: source,/)
  const cal = leer('app/api/[tenant]/evergreen/webhooks/calendly/route.ts')
  assert.match(cal, /leadChannel: 'calendly',/)
})

test('semántica del canal: variante normalizada, vacío es hueco (NULL), never filler', () => {
  // Réplica congelada de contacts_normalize_lead_channel (20260923100000) para fijar la semántica
  // que aplica la función al estampar: trim + colapsar espacios + minúsculas; vacío → NULL.
  const normalizar = (v) => {
    if (v === null) return null
    const s = v.replace(/\s+/g, ' ').trim().toLowerCase()
    return s === '' ? null : s
  }
  assert.equal(normalizar('  Calendly  '), 'calendly')
  assert.equal(normalizar('Facebook   Ads'), 'facebook ads')
  assert.equal(normalizar('   '), null, 'un vacío no es un valor: hueco de captura')
  assert.equal(normalizar(null), null)
})
