import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchAllRows, PAGE_SIZE } from '../../lib/supabase/paginate.ts'

// PostgREST devuelve como máximo 1.000 filas y NO dice que ha recortado: la consulta responde `ok`
// con las primeras 1.000. Una suma sobre eso (gasto de campañas, comisiones del mes, cash collected)
// da un número más bajo que el real y con toda la pinta de ser correcto.

/** Tabla de mentira de `total` filas que responde por rangos, como PostgREST. */
function fakeTable(total, { errorOnPage } = {}) {
  const llamadas = []
  return {
    llamadas,
    make: () => ({
      range: async (from, to) => {
        llamadas.push([from, to])
        if (errorOnPage != null && llamadas.length - 1 === errorOnPage) {
          return { data: null, error: { message: 'boom' } }
        }
        const rows = []
        for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ i })
        return { data: rows, error: null }
      },
    }),
  }
}

test('trae TODAS las páginas, no solo la primera', async () => {
  const t = fakeTable(2500)
  const r = await fetchAllRows(t.make)
  assert.equal(r.rows.length, 2500)
  assert.equal(r.error, null)
  assert.equal(r.truncated, false)
  assert.equal(t.llamadas.length, 3)
  assert.deepEqual(t.llamadas[0], [0, PAGE_SIZE - 1])
  assert.deepEqual(t.llamadas[1], [PAGE_SIZE, PAGE_SIZE * 2 - 1])
})

test('una página incompleta significa fin: no pide otra de más', async () => {
  const t = fakeTable(10)
  const r = await fetchAllRows(t.make)
  assert.equal(r.rows.length, 10)
  assert.equal(t.llamadas.length, 1)
})

test('un total exactamente múltiplo del tamaño de página pide una más y se para', async () => {
  const t = fakeTable(2000)
  const r = await fetchAllRows(t.make)
  assert.equal(r.rows.length, 2000)
  assert.equal(t.llamadas.length, 3, 'la tercera vuelve vacía y cierra')
  assert.equal(r.truncated, false)
})

test('un error corta y se reporta: un hueco no es un cero', async () => {
  const t = fakeTable(5000, { errorOnPage: 1 })
  const r = await fetchAllRows(t.make)
  assert.equal(r.error, 'boom')
  assert.equal(r.rows.length, PAGE_SIZE, 'se devuelve lo leído, pero con el error visible')
})

test('al agotar el tope de páginas lo dice en vez de fingir que están todas', async () => {
  const t = fakeTable(10_000)
  const r = await fetchAllRows(t.make, { pageSize: 100, maxPages: 3 })
  assert.equal(r.rows.length, 300)
  assert.equal(r.truncated, true)
  assert.equal(r.error, null)
})
