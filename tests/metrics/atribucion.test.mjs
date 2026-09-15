import assert from 'node:assert/strict'
import test from 'node:test'
import { leerToque, registrarToque, toqueTieneDatos } from '../../lib/contacts/atribucion.ts'

// ---------------------------------------------------------------------------------------------
// LEER EL ORIGEN DE DONDE SUELE VENIR, sin exigir un formato: exigirlo significaría perder la
// atribución del siguiente proveedor que cambie la forma del payload.
// ---------------------------------------------------------------------------------------------

test('encuentra los UTMs en las rutas conocidas de cada proveedor', () => {
  // Calendly los pone bajo `tracking`.
  assert.equal(leerToque({ tracking: { utm_source: 'meta' } }).utmSource, 'meta')
  // GHL a veces en `contact`, a veces en la raíz.
  assert.equal(leerToque({ contact: { utm_campaign: 'closers-sep' } }).utmCampaign, 'closers-sep')
  assert.equal(leerToque({ utm_medium: 'cpc' }).utmMedium, 'cpc')
  // Y una landing propia puede mandarlos en camelCase.
  assert.equal(leerToque({ utmTerm: 'setter-ana' }).utmTerm, 'setter-ana')
})

test('el bloque anidado gana a la raíz cuando los dos traen el dato', () => {
  const t = leerToque({ utm_source: 'raiz', tracking: { utm_source: 'meta' } })
  assert.equal(t.utmSource, 'meta')
})

test('una cadena vacía o con espacios no es un origen', () => {
  const t = leerToque({ tracking: { utm_source: '   ', utm_campaign: '' } })
  assert.equal(t.utmSource, null)
  assert.equal(t.utmCampaign, null)
})

test('un payload sin tracking no inventa origen', () => {
  // Es el caso REAL de producción: 0 de 559 citas traen UTMs, porque los enlaces no los llevan.
  for (const payload of [{}, null, undefined, 'texto', { invitee: { email: 'x' } }]) {
    const t = leerToque(payload)
    assert.equal(toqueTieneDatos(t), false, JSON.stringify(payload))
  }
})

test('un toque vacío no se escribe', async () => {
  let escrituras = 0
  const sb = {
    from: () => {
      escrituras++
      throw new Error('no debería consultarse')
    },
  }
  const r = await registrarToque(sb, 't1', 'c1', {})
  assert.deepEqual(r, { ok: true, accion: 'sin_datos' })
  assert.equal(escrituras, 0)
})

// ---------------------------------------------------------------------------------------------
// EL PRIMER TOQUE NO SE SOBRESCRIBE NUNCA.
//
// Si alguien llega por un anuncio de Meta y dos semanas después vuelve por un email, el anuncio es quien
// lo trajo. Machacar el primer toque hace que el canal que remata se lleve el mérito del que capta — y con
// eso se decide el presupuesto: se acabaría apagando lo que trae gente para reforzar lo que solo la cierra.
// ---------------------------------------------------------------------------------------------

function sbFalso({ existente }) {
  const escrito = { insert: null, update: null }
  const sb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: existente, error: null }) }),
          }),
        }),
      }),
      insert: async (fila) => {
        escrito.insert = fila
        return { error: null }
      },
      update: (fila) => {
        escrito.update = fila
        return { eq: async () => ({ error: null }) }
      },
    }),
  }
  return { sb, escrito }
}

test('el primer toque crea la fila con first_* y last_*', async () => {
  const { sb, escrito } = sbFalso({ existente: null })
  const r = await registrarToque(sb, 't1', 'c1', {
    utmSource: 'meta',
    utmCampaign: 'closers',
    enEl: '2026-09-01T10:00:00Z',
  })
  assert.deepEqual(r, { ok: true, accion: 'creada' })
  assert.equal(escrito.insert.first_utm_source, 'meta')
  assert.equal(escrito.insert.last_utm_source, 'meta')
  assert.equal(escrito.insert.first_touch_at, '2026-09-01T10:00:00Z')
  assert.equal(escrito.insert.is_primary, true)
  assert.equal(escrito.insert.tenant_id, 't1')
})

test('un toque posterior actualiza el último y NO toca el primero', async () => {
  const { sb, escrito } = sbFalso({ existente: { id: 'a1', first_touch_at: '2026-09-01T10:00:00Z' } })
  const r = await registrarToque(sb, 't1', 'c1', { utmSource: 'email', enEl: '2026-09-20T10:00:00Z' })
  assert.deepEqual(r, { ok: true, accion: 'actualizada' })
  assert.equal(escrito.update.last_utm_source, 'email')
  assert.equal(escrito.update.last_touch_at, '2026-09-20T10:00:00Z')
  // LA LÍNEA QUE PROTEGE EL ORIGEN: ninguna clave first_* en el update.
  for (const clave of Object.keys(escrito.update)) {
    assert.ok(!clave.startsWith('first_'), `el update no puede tocar ${clave}`)
  }
  assert.equal(escrito.insert, null, 'no debe insertar una segunda fila primaria')
})

test('un error de lectura no se traga: se devuelve', async () => {
  const sb = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }),
        }),
      }),
    }),
  }
  const r = await registrarToque(sb, 't1', 'c1', { utmSource: 'meta' })
  assert.deepEqual(r, { ok: false, error: 'boom' })
})
