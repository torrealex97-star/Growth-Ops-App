import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { mensajeDeCarga, primerError } from '../lib/supabase/resultado.ts'

// S0.6 — UN HUECO NO ES UN CERO, TAMBIÉN EN PANTALLA.
//
// Las pantallas de dinero leían varias tablas a la vez y hacían `salesRes.data || []`. Si una consulta
// fallaba —permisos, red, un cambio de esquema—, la lista quedaba vacía y el panel pintaba **0 €** con
// total seguridad. Nadie distingue "este mes no hubo ventas" de "no se pudo leer la tabla de ventas",
// y sobre esa cifra se toman decisiones.
//
// El arreglo no es adivinar: es decir que faltan datos y no enseñar números a medias.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

// Las tres pantallas donde un cero falso es más caro: el panel principal, el resumen financiero y las
// métricas de rentabilidad. Añadir aquí una pantalla nueva de dinero es parte de hacerla.
const PANTALLAS_DE_DINERO = [
  'app/[tenant]/dashboard/page.tsx',
  'app/[tenant]/finanzas/analitica/resumen/page.tsx',
  'app/[tenant]/unit-economics/page.tsx',
]

test('primerError distingue "sin filas" de "no se pudo leer"', () => {
  assert.equal(primerError({ data: [], error: null }, { data: null, error: null }), null)
  assert.equal(primerError({ error: { message: 'permission denied' } }), 'permission denied')
  // Un error sin mensaje sigue siendo un error: nunca se devuelve null por no traer texto.
  assert.equal(primerError({ error: {} }), 'La consulta no se pudo completar.')
  // Se queda con el PRIMERO: basta uno para que las cifras no se puedan mostrar.
  assert.equal(primerError({ error: { message: 'uno' } }, { error: { message: 'dos' } }), 'uno')
  assert.equal(primerError(null, undefined), null)
})

test('el mensaje dice qué falta y por qué no hay números', () => {
  const m = mensajeDeCarga('los datos de facturación', 'timeout')
  assert.match(m, /No se pudieron cargar los datos de facturación/)
  assert.match(m, /no se muestran/)
  assert.match(m, /timeout/)
})

test('las pantallas de dinero comprueban el error de sus consultas', () => {
  for (const pantalla of PANTALLAS_DE_DINERO) {
    const src = leer(pantalla)
    assert.match(src, /primerError\(/, `${pantalla}: no comprueba si alguna consulta falló`)
    assert.match(src, /errorCarga/, `${pantalla}: no guarda el estado de error`)
  }
})

test('y lo enseñan en pantalla, con reintento', () => {
  for (const pantalla of PANTALLAS_DE_DINERO) {
    const src = leer(pantalla)
    assert.match(src, /\{errorCarga/, `${pantalla}: el error no llega a pintarse`)
    assert.match(src, /Reintentar/, `${pantalla}: sin salida para quien lo ve`)
  }
})
