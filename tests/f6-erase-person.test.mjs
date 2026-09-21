import assert from 'node:assert/strict'
import test from 'node:test'

import { erasePerson } from '../lib/privacidad/erase-person.ts'
import { POLITICA_SIN_DECIDIR } from '../lib/privacidad/plan-borrado.ts'
import { TENANT_A, TENANT_B, contactoDe } from './fixtures/tenants-sinteticos.mjs'

// F6 — EL EJECUTOR DE `erase_person`.
//
// Lo que se prueba aquí no es "borra": es que el ACTA sea fiable. Un informe que dice "hecho" sobre
// un store que no se tocó cierra en falso una solicitud de borrado que sigue abierta, y eso es peor
// que no tener informe.
//
// Se ejercita con un doble del cliente que registra cada operación, así que los tests comprueban
// QUÉ se pidió a la base (tabla, filtros, columnas) sin necesitar una.

const CONTACTO = contactoDe(TENANT_A, 1)
const POLITICA_COMPLETA = { raw: 'anonimizar', transcripciones: 'borrar', hechosFinancieros: 'conservar_sin_pii' }

/** Doble del cliente Supabase: registra las llamadas y devuelve lo que se le indique. */
function sbFalso({
  contacto = { email: CONTACTO.email, email_normalized: CONTACTO.email },
  count = 1,
  error = null,
} = {}) {
  const ops = []
  const cadena = (registro) => {
    const q = {
      eq(col, val) {
        registro.filtros[col] = val
        return q
      },
      is(col, val) {
        registro.filtros[col] = val
        return q
      },
      or(expr) {
        registro.or = expr
        return q
      },
      select() {
        return q
      },
      maybeSingle() {
        return Promise.resolve({ data: contacto, error: null })
      },
      then(resolve) {
        return Promise.resolve({ count, error }).then(resolve)
      },
    }
    return q
  }
  return {
    ops,
    from(tabla) {
      return {
        select() {
          const r = { tabla, tipo: 'select', filtros: {} }
          ops.push(r)
          return cadena(r)
        },
        delete() {
          const r = { tabla, tipo: 'delete', filtros: {} }
          ops.push(r)
          return cadena(r)
        },
        update(valores) {
          const r = { tabla, tipo: 'update', valores, filtros: {} }
          ops.push(r)
          return cadena(r)
        },
        insert(fila) {
          const r = { tabla, tipo: 'insert', fila, filtros: {} }
          ops.push(r)
          return Promise.resolve({ error: null })
        },
      }
    },
  }
}

const paso = (informe, store) => informe.pasos.find((p) => p.store === store)
const correr = (sb, extra = {}) =>
  erasePerson(sb, { tenantId: TENANT_A.id, contactId: CONTACTO.id, politica: POLITICA_COMPLETA, ...extra })

// ── EL ACTA NO MIENTE ────────────────────────────────────────────────────────────────────────

test('sin política de retención, el borrado no puede declararse completo', async () => {
  const informe = await correr(sbFalso(), { politica: POLITICA_SIN_DECIDIR })
  assert.equal(informe.completo, false)
  assert.ok(informe.pasos.filter((p) => p.estado === 'BLOQUEADO').length >= 3)
})

test('con stores bloqueados, la PII del contacto se borra IGUALMENTE', async () => {
  // La primera versión lo bloqueaba "por prudencia". Era un error: `raw_events` está bloqueado de
  // forma permanente hasta que F1 le dé un vínculo, así que el nombre, el correo y el teléfono se
  // habrían quedado en el CRM para siempre. Peor para la persona que el riesgo que se evitaba.
  const informe = await correr(sbFalso(), { politica: POLITICA_SIN_DECIDIR })
  assert.notEqual(paso(informe, 'contacts').estado, 'BLOQUEADO')
  // Y el informe sigue diciendo la verdad: no está completo.
  assert.equal(informe.completo, false)
})

test('un error de la base sale como FALLIDO, no se disuelve en un "todo bien"', async () => {
  const informe = await correr(sbFalso({ error: { message: 'permission denied' } }))
  assert.ok(informe.pasos.some((p) => p.estado === 'FALLIDO'))
  assert.equal(informe.completo, false)
  assert.match(paso(informe, 'contact_notes').motivo, /permission denied/)
})

test('sin filas que borrar el estado es SIN_DATOS, no HECHO', async () => {
  // Distinguirlo importa: "no había nada" y "se borró algo" no son lo mismo en un acta de borrado.
  const informe = await correr(sbFalso({ count: 0 }))
  assert.equal(paso(informe, 'contact_notes').estado, 'SIN_DATOS')
})

test('repetirlo sobre alguien ya borrado no falla: todo sale SIN_DATOS', async () => {
  const informe = await correr(sbFalso({ count: 0, contacto: { email: null, email_normalized: null } }))
  // Nada falla. `raw_events` sigue bloqueado por falta de vínculo, que no es un fallo de idempotencia.
  assert.equal(
    informe.pasos.every((p) => p.estado === 'SIN_DATOS' || p.estado === 'HECHO' || p.store === 'raw_events'),
    true
  )
  assert.equal(
    informe.pasos.some((p) => p.estado === 'FALLIDO'),
    false
  )
})

// ── RAW_EVENTS: UNA LIMITACIÓN REAL, NO UNA DECISIÓN PENDIENTE ───────────────────────────────

test('raw_events queda bloqueado incluso con la política decidida', async () => {
  // Sus columnas son id, tenant_id, source, payload, created_at: no hay forma de localizar los
  // payloads de una persona. Decidir la retención no lo desbloquea; hace falta que F1 deje el vínculo.
  const informe = await correr(sbFalso())
  const raw = paso(informe, 'raw_events')
  assert.equal(raw.estado, 'BLOQUEADO')
  assert.match(raw.motivo, /no tiene contact_id/)
  assert.match(raw.motivo, /F1/)
})

// ── LO QUE SE LE PIDE A LA BASE ──────────────────────────────────────────────────────────────

test('toda operación va acotada por subcuenta', async () => {
  const sb = sbFalso()
  await correr(sb)
  for (const op of sb.ops.filter((o) => o.tipo !== 'insert')) {
    assert.equal(op.filtros.tenant_id, TENANT_A.id, `${op.tabla}: operación sin acotar por subcuenta`)
    assert.notEqual(op.filtros.tenant_id, TENANT_B.id)
  }
})

test('los correos se leen ANTES de anonimizar el contacto', async () => {
  // Después ya no existirían, y fathom_match_review los necesita para alcanzar las filas que nunca
  // tuvieron contacto asociado.
  const sb = sbFalso()
  await correr(sb)
  const lee = sb.ops.findIndex((o) => o.tabla === 'contacts' && o.tipo === 'select')
  const anonimiza = sb.ops.findIndex((o) => o.tabla === 'contacts' && o.tipo === 'update')
  assert.ok(lee > -1 && anonimiza > -1)
  assert.ok(lee < anonimiza)
})

test('fathom_match_review se borra por contacto Y por correo', async () => {
  const sb = sbFalso()
  await correr(sb)
  const op = sb.ops.find((o) => o.tabla === 'fathom_match_review')
  assert.match(op.or, /contact_id\.eq\./)
  assert.match(op.or, /invitee_email\.in\./)
})

test('el contacto se anonimiza y se marca, en la misma operación', async () => {
  const sb = sbFalso()
  await correr(sb)
  const op = sb.ops.find((o) => o.tabla === 'contacts' && o.tipo === 'update')
  assert.equal(op.valores.lifecycle, 'erased')
  for (const col of ['full_name', 'email', 'email_normalized', 'phone', 'phone_normalized']) {
    assert.equal(op.valores[col], null, `falta vaciar ${col}`)
  }
})

// ── AUDITORÍA Y SIMULACIÓN ───────────────────────────────────────────────────────────────────

test('el audit guarda el hecho, nunca la PII que se acaba de borrar', async () => {
  const sb = sbFalso()
  const informe = await correr(sb)
  const audit = sb.ops.find((o) => o.tabla === 'audit_logs')
  assert.equal(audit.fila.action, 'erase_person')
  assert.equal(audit.fila.entity_id, null, 'el id de la persona no puede quedar en el audit')
  const serializado = JSON.stringify(audit.fila)
  assert.ok(!serializado.includes(CONTACTO.id), 'el contact_id no puede aparecer')
  assert.ok(!serializado.includes(CONTACTO.email), 'el correo no puede aparecer')
  assert.match(informe.personaHash, /^[0-9a-f]{32}$/)
})

test('el hash lleva sal por subcuenta: no correlaciona personas entre clientes', async () => {
  const a = await erasePerson(sbFalso(), { tenantId: TENANT_A.id, contactId: 'x', politica: POLITICA_COMPLETA })
  const b = await erasePerson(sbFalso(), { tenantId: TENANT_B.id, contactId: 'x', politica: POLITICA_COMPLETA })
  assert.notEqual(a.personaHash, b.personaHash)
})

test('en simulación no se toca nada ni se escribe audit', async () => {
  const sb = sbFalso()
  const informe = await correr(sb, { simulacion: true })
  assert.equal(informe.simulacion, true)
  assert.equal(
    sb.ops.some((o) => o.tipo === 'delete' || o.tipo === 'update' || o.tabla === 'audit_logs'),
    false,
    'una simulación que escribe no es una simulación'
  )
  assert.match(paso(informe, 'contact_notes').motivo, /simulación/)
})

test('el informe enumera lo que queda pendiente en proveedores externos', async () => {
  const informe = await correr(sbFalso())
  const nombres = informe.pendienteEnProveedores.map((p) => p.nombre)
  for (const esperado of ['GHL', 'Stripe', 'Fathom']) assert.ok(nombres.includes(esperado))
})
