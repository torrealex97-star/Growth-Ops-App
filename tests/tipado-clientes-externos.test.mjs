import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ---------------------------------------------------------------------------------------------
// UN `any` EN EL CLIENTE DE META NO ES UN DESCUIDO DE ESTILO: ES UN AGUJERO EN LAS MÉTRICAS DE DINERO.
//
// Si Meta renombra un campo, `r.spend` pasa a `undefined`, `Number(undefined)` es NaN, y el CPL y el CAC
// salen NaN o 0 sin que nada falle ni nadie se entere. Con `any` el compilador no puede avisar, porque
// `any` permite leer cualquier propiedad de cualquier cosa.
// ---------------------------------------------------------------------------------------------

test('los clientes del Graph API no usan any', () => {
  for (const f of ['lib/meta/client.ts', 'lib/instagram/client.ts']) {
    const codigo = sinComentarios(leer(f))
    assert.doesNotMatch(codigo, /:\s*any\b/, `${f} declara un any`)
    assert.doesNotMatch(codigo, /\bas any\b/, `${f} hace un cast a any`)
    assert.doesNotMatch(codigo, /\bany\[\]/, `${f} declara un array de any`)
  }
})

// No se finge conocer el esquema del Graph API —cambia sin avisar—: se declara que es un objeto de
// claves desconocidas, y eso obliga a convertir cada campo al leerlo.
test('la forma de la respuesta se declara como desconocida, no inventada', () => {
  for (const f of ['lib/meta/client.ts', 'lib/instagram/client.ts']) {
    assert.match(leer(f), /type FilaGraph = Record<string, unknown>/, f)
  }
})

test('los campos embebidos se leen sin dar por hecho que llegaron', () => {
  for (const f of ['lib/meta/client.ts', 'lib/instagram/client.ts']) {
    const codigo = leer(f)
    assert.match(codigo, /function leerAnidado\(valor: unknown, clave: string\)/, f)
    // Lo que delata el fallo anterior: acceder al embebido con `?.` y usarlo como si fuera string.
    assert.doesNotMatch(sinComentarios(codigo), /r\.adset\?\.name/, f)
    assert.doesNotMatch(sinComentarios(codigo), /instagram_business_account\?\.id/, f)
  }
})

// ---------------------------------------------------------------------------------------------
// `catch (e: any)` + `e.message` COMPILA aunque lo lanzado no sea un Error, y entonces la pantalla
// enseña "Error: undefined", que es peor que no enseñar nada.
// ---------------------------------------------------------------------------------------------

test('no queda ningún catch tipado como any', () => {
  const dirs = ['app', 'components', 'lib']
  const malos = []
  const walk = async (d) => {
    const { readdirSync } = await import('node:fs')
    for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`
      if (e.isDirectory()) await walk(p)
      else if (/\.tsx?$/.test(e.name) && /catch\s*\([^)]*:\s*any\s*\)/.test(sinComentarios(leer(p)))) malos.push(p)
    }
  }
  return Promise.all(dirs.map(walk)).then(() => {
    assert.deepEqual(malos, [], 'un catch como any deja pasar "Error: undefined" a la pantalla')
  })
})

test('el mensaje de error se saca comprobando el tipo, no asumiéndolo', () => {
  const codigo = leer('app/[tenant]/setting-ai/page.tsx')
  assert.match(codigo, /function mensajeDeError\(e: unknown\): string/)
  assert.match(codigo, /if \(e instanceof Error\) return e\.message/)
  // Y nunca deja el hueco en blanco: un fallo sin mensaje sigue diciendo algo.
  assert.match(codigo, /return 'fallo inesperado'/)
})
