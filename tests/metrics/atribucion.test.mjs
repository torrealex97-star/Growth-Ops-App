import assert from 'node:assert/strict'
import test from 'node:test'
import { atribuirDesdePayload, leerToque, registrarToque, toqueTieneDatos } from '../../lib/contacts/atribucion.ts'

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
  const escrito = { insert: null, update: null, updates: [], isGuard: null }
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
        escrito.updates.push(fila)
        return {
          eq: () => ({
            error: null,
            // La segunda .eq() SOLO existiría si el bug volviera: el guard real usa .is().
            eq: (col, val) => {
              escrito.isGuard = { metodo: 'eq', col, val }
              return { error: null }
            },
            is: (col, val) => {
              escrito.isGuard = { metodo: 'is', col, val }
              return { error: null }
            },
          }),
        }
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
  // La fila ya trae sus first_* con valor: el update no puede tocarlos NI REEMPLAZARLOS.
  const { sb, escrito } = sbFalso({
    existente: {
      id: 'a1',
      first_touch_at: '2026-09-01T10:00:00Z',
      last_touch_at: '2026-09-01T10:00:00Z',
      first_utm_source: 'meta',
      first_utm_medium: 'cpc',
      first_utm_campaign: 'closers',
      first_utm_content: null,
      first_utm_term: null,
      source: 'calendly',
      funnel: null,
    },
  })
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

test('el relleno de colaborador vacío usa .is(), no .eq() — PostgREST trata eq(col, null) como el texto "null"', async () => {
  const { sb, escrito } = sbFalso({
    existente: { id: 'a1', first_touch_at: '2026-09-01T10:00:00Z', collaborator_id: null },
  })
  const r = await registrarToque(sb, 't1', 'c1', {
    utmSource: 'ref',
    colaboradorId: 'colab-1',
    enEl: '2026-09-20T10:00:00Z',
  })
  assert.deepEqual(r, { ok: true, accion: 'actualizada' })
  assert.deepEqual(escrito.isGuard, { metodo: 'is', col: 'collaborator_id', val: null })
})

test('un colaborador ya asignado no se pisa (first-valid-collaborator-wins): no llama al guard de relleno', async () => {
  const { sb, escrito } = sbFalso({
    existente: { id: 'a1', first_touch_at: '2026-09-01T10:00:00Z', collaborator_id: 'colab-viejo' },
  })
  const r = await registrarToque(sb, 't1', 'c1', {
    utmSource: 'ref',
    colaboradorId: 'colab-nuevo',
    enEl: '2026-09-20T10:00:00Z',
  })
  assert.deepEqual(r, { ok: true, accion: 'actualizada' })
  assert.equal(escrito.isGuard, null, 'no debe intentar rellenar un colaborador ya asignado')
})

test('un toque posterior RELLENA el hueco del primer toque (null no es un toque)', async () => {
  // Contacto importado (ghl_import) ANTES de que existieran UTMs: su fila no tiene first_utm_*.
  // El primer toque con UTMs que llega —aunque sea posterior— se convierte en el primer toque
  // conocido. Rellenar un hueco no es sobrescribir el origen: es dejar de no saber.
  const { sb, escrito } = sbFalso({
    existente: {
      id: 'a1',
      first_touch_at: '2026-09-01T10:00:00Z',
      last_touch_at: '2026-09-01T10:00:00Z',
      first_utm_source: null,
      first_utm_medium: null,
      first_utm_campaign: null,
      first_utm_content: null,
      first_utm_term: null,
      source: 'ghl_import',
      funnel: null,
    },
  })
  const r = await registrarToque(sb, 't1', 'c1', { utmSource: 'IG', enEl: '2026-09-20T10:00:00Z' })
  assert.deepEqual(r, { ok: true, accion: 'actualizada' })
  assert.equal(escrito.update.first_utm_source, 'IG', 'rellena el hueco del primer toque')
  assert.equal(escrito.update.last_utm_source, 'IG')
  // El source ya tiene valor (ghl_import): no se pisa con el canal del toque.
  assert.equal(escrito.update.source, undefined)
})

test('un toque ANTIGUO no se presenta como último: last_* queda y no se escribe nada si no hay huecos', async () => {
  // La sync por pull relee histórico: un invitee reservado el día 10 NO puede machacar el
  // last_touch del día 20 — la pasada de hoy no es el origen de un lead de hace semanas.
  const { sb, escrito } = sbFalso({
    existente: {
      id: 'a1',
      first_touch_at: '2026-09-01T10:00:00Z',
      last_touch_at: '2026-09-20T10:00:00Z',
      first_utm_source: 'meta',
      first_utm_medium: 'cpc',
      first_utm_campaign: 'closers',
      first_utm_content: null,
      first_utm_term: null,
      source: 'meta',
      funnel: null,
    },
  })
  const r = await registrarToque(sb, 't1', 'c1', { utmSource: 'IG', enEl: '2026-09-10T10:00:00Z' })
  assert.deepEqual(r, { ok: true, accion: 'actualizada' })
  assert.equal(escrito.update, null, 'sin huecos que rellenar, un toque antiguo no escribe nada')
  assert.equal(escrito.insert, null)
})

test('un toque antiguo rellena huecos del origen pero NUNCA el último', async () => {
  const { sb, escrito } = sbFalso({
    existente: {
      id: 'a1',
      first_touch_at: '2026-09-01T10:00:00Z',
      last_touch_at: '2026-09-20T10:00:00Z',
      first_utm_source: null,
      first_utm_medium: null,
      first_utm_campaign: null,
      first_utm_content: null,
      first_utm_term: null,
      source: null,
      funnel: null,
    },
  })
  const r = await registrarToque(sb, 't1', 'c1', { utmSource: 'IG', source: 'calendly', enEl: '2026-09-10T10:00:00Z' })
  assert.deepEqual(r, { ok: true, accion: 'actualizada' })
  assert.equal(escrito.update.first_utm_source, 'IG')
  assert.equal(escrito.update.source, 'calendly')
  assert.equal(escrito.update.last_utm_source, undefined, 'last_* intacto: el toque era anterior')
  assert.equal(escrito.update.last_touch_at, undefined, 'last_touch_at intacto')
})

test('atribuirDesdePayload: lee el tracking del invitee, sella la fecha del payload y crea la fila', async () => {
  const { sb, escrito } = sbFalso({ existente: null })
  const { toque, resultado } = await atribuirDesdePayload(
    sb,
    't1',
    'c1',
    { tracking: { utm_source: 'IG', utm_medium: 'Bio', utm_campaign: 'organic', utm_content: 'link_in_bio' } },
    { source: 'calendly', enEl: '2026-09-05T10:00:00Z' }
  )
  assert.deepEqual(resultado, { ok: true, accion: 'creada' })
  assert.equal(toque.utmSource, 'IG')
  // El source declarado por el payload gana al del proveedor (misma semántica que el webhook).
  assert.equal(escrito.insert.source, 'IG')
  assert.equal(escrito.insert.first_touch_at, '2026-09-05T10:00:00Z', 'la fecha del toque es la de la reserva')
})

test('atribuirDesdePayload: payload sin atribución ⇒ sin datos y CERO consultas (un hueco no es un cero)', async () => {
  let consultas = 0
  const sb = {
    from: () => {
      consultas++
      throw new Error('no debería consultarse')
    },
  }
  const { toque, resultado } = await atribuirDesdePayload(sb, 't1', 'c1', { email: 'x@y.z' }, { source: 'calendly' })
  assert.deepEqual(resultado, { ok: true, accion: 'sin_datos' })
  assert.equal(toqueTieneDatos(toque), false, 'el toque devuelto no inventa origen')
  assert.equal(consultas, 0)
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
