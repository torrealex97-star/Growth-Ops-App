import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { buscarContactoPorEmail } from '../lib/contacts/buscar.ts'
import { TENANT_A, TENANT_B } from './fixtures/tenants-sinteticos.mjs'

// F6 — VINCULAR PII SUELTA A SU CONTACTO, SIN EQUIVOCARSE DE PERSONA.
//
// `fathom_match_review` guarda el correo de quien aparecía en una reunión que el sync no supo
// emparejar: 177 filas reales sin ninguna referencia a `contacts`, así que `erase_person` —que es un
// comando por contact_id— no las alcanzaba (`docs/F6-MAPA-PII.md` §1.2).
//
// El riesgo al arreglarlo no es no vincular: es vincular MAL. Un vínculo equivocado mete el correo
// de una persona en el expediente de otra, y encima lo borraría el `erase_person` equivocado. Por
// eso el emparejamiento es deliberadamente conservador y estos tests fijan exactamente cuándo se
// abstiene.

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// Doble mínimo del cliente: registra la consulta construida y devuelve las filas que se le den.
function sbFalso(filas, registro = {}) {
  const query = {
    _filtros: {},
    select() {
      return query
    },
    eq(col, val) {
      query._filtros[col] = val
      return query
    },
    is(col, val) {
      query._filtros[col] = val
      return query
    },
    limit(n) {
      registro.limite = n
      registro.filtros = { ...query._filtros }
      return Promise.resolve({ data: filas, error: null })
    },
  }
  return {
    from(tabla) {
      registro.tabla = tabla
      return query
    },
  }
}

const CONTACTO_A = { id: 'contacto-de-a' }

test('devuelve el contacto cuando hay exactamente una coincidencia', async () => {
  const r = {}
  const id = await buscarContactoPorEmail(sbFalso([CONTACTO_A], r), TENANT_A.id, 'Persona1@Tenant-A.example.test')
  assert.equal(id, 'contacto-de-a')
})

test('la búsqueda va acotada por subcuenta y excluye contactos absorbidos', async () => {
  const r = {}
  await buscarContactoPorEmail(sbFalso([CONTACTO_A], r), TENANT_A.id, 'x@example.test')
  assert.equal(r.tabla, 'contacts')
  assert.equal(r.filtros.tenant_id, TENANT_A.id, 'sin este filtro se buscaría en toda la plataforma')
  assert.equal(r.filtros.merged_into, null, 'un contacto absorbido por un merge no debe recibir PII nueva')
})

test('normaliza el correo antes de comparar: espacios y mayúsculas no deciden', async () => {
  const r = {}
  await buscarContactoPorEmail(sbFalso([CONTACTO_A], r), TENANT_A.id, '  PERSONA@Example.TEST  ')
  assert.equal(r.filtros.email_normalized, 'persona@example.test')
})

test('ante ambigüedad se abstiene: dos contactos con el mismo correo no vinculan', async () => {
  // Preferir no vincular a vincular mal. Con dos fichas compartiendo correo (un merge a medias),
  // elegir una metería la PII en el expediente equivocado.
  const id = await buscarContactoPorEmail(sbFalso([CONTACTO_A, { id: 'otro' }]), TENANT_A.id, 'x@example.test')
  assert.equal(id, null)
})

test('pide dos filas, no una: así puede detectar la ambigüedad en vez de ignorarla', async () => {
  const r = {}
  await buscarContactoPorEmail(sbFalso([CONTACTO_A], r), TENANT_A.id, 'x@example.test')
  assert.equal(r.limite, 2, 'con limit(1) un duplicado pasaría desapercibido y se vincularía al azar')
})

test('sin coincidencia devuelve null, y no se inventa ni se crea una ficha', async () => {
  assert.equal(await buscarContactoPorEmail(sbFalso([]), TENANT_A.id, 'nadie@example.test'), null)
})

test('correo ausente, vacío o en blanco devuelve null sin consultar', async () => {
  const r = {}
  for (const valor of [null, undefined, '', '   ']) {
    assert.equal(await buscarContactoPorEmail(sbFalso([CONTACTO_A], r), TENANT_A.id, valor), null)
  }
  assert.equal(r.tabla, undefined, 'no debería haberse consultado la base de datos')
})

test('un error de la consulta no se interpreta como "no hay contacto" silencioso', async () => {
  const sb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ is: () => ({ limit: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }) }),
        }),
      }),
    }),
  }
  assert.equal(await buscarContactoPorEmail(sb, TENANT_A.id, 'x@example.test'), null)
})

// ── LA MIGRACIÓN ─────────────────────────────────────────────────────────────────────────────

test('la migración vincula por cita resuelta y por correo, siempre dentro de la subcuenta', () => {
  const sql = readFileSync(
    join(root, 'supabase/migrations/20260921100000_f6_fathom_match_review_contact_id.sql'),
    'utf8'
  )
  // Los dos caminos de backfill.
  assert.match(sql, /resolved_appointment_id IS NOT NULL/)
  assert.match(sql, /c\.email_normalized = lower\(btrim\(f\.invitee_email\)\)/)
  // Ninguno puede cruzar subcuentas, ni siquiera partiendo de un id conocido.
  assert.match(sql, /a\.tenant_id = f\.tenant_id/)
  assert.match(sql, /c\.tenant_id = f\.tenant_id/)
  // Ni apuntar a un contacto absorbido.
  assert.match(sql, /merged_into IS NULL/)
})

test('la migración se abstiene ante correos duplicados, igual que el código', () => {
  const sql = readFileSync(
    join(root, 'supabase/migrations/20260921100000_f6_fathom_match_review_contact_id.sql'),
    'utf8'
  )
  assert.match(sql, /\)\s*=\s*1;/, 'el backfill exige coincidencia única')
})

test('la columna queda nullable a propósito y con su motivo escrito', () => {
  const sql = readFileSync(
    join(root, 'supabase/migrations/20260921100000_f6_fathom_match_review_contact_id.sql'),
    'utf8'
  )
  assert.doesNotMatch(sql, /ALTER COLUMN contact_id SET NOT NULL/)
  // 108 de las 177 filas llevan correos de personas que no son contactos: forzar NOT NULL obligaría
  // a inventarse un vínculo. El comentario de la columna tiene que explicarlo.
  assert.match(sql, /COMMENT ON COLUMN public\.fathom_match_review\.contact_id/)
  assert.match(sql, /erase_person/)
})

test('el sync nuevo vincula al insertar, y no crea fichas por un correo suelto', () => {
  const ruta = 'app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts'
  const src = readFileSync(join(root, ruta), 'utf8')
  assert.match(src, /buscarContactoPorEmail\(sb, tenantId, email\)/)
  assert.match(src, /contact_id: contactId/)
  // `getOrCreateContact` daría de alta a cualquiera que aparezca en una reunión: más PII que borrar.
  assert.doesNotMatch(src.replace(/\/\/[^\n]*/g, ''), /getOrCreateContact/)
})

test('los fixtures A y B siguen siendo subcuentas distintas para estas pruebas', () => {
  assert.notEqual(TENANT_A.id, TENANT_B.id)
})
