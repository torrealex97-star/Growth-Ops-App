import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { detalleMuestra, esMuestraBaja, promedio, razon } from '../lib/metrics/razon.ts'

// AUDITORÍA F22 / F18 — UNA RAZÓN SIN MUESTRA NO ES CERO.
//
// CSM enseñaba show rate y éxito al 0 % sin un solo evento; Alumnos, el onboarding al 0 % sin ningún
// acceso enviado; Bajas dividía la recuperación entre TODAS las solicitudes, contando como «no
// recuperada» a cada una todavía en proceso. Un 0 % se lee como «rendimiento cero»; lo cierto es «no hay
// casos» o «aún no se ha cerrado ninguno».

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

test('sin casos no hay porcentaje: null, no 0', () => {
  assert.equal(razon(0, 0).valor, null)
  assert.equal(razon(0, 4).valor, 0, 'un 0 con casos SÍ es un 0 real')
  assert.equal(razon(3, 4).valor, 75)
})

test('la media sin valores es null, no 0', () => {
  assert.equal(promedio([]), null)
  assert.equal(promedio([8, 10]), 9)
})

test('un 100 % sobre un solo caso se marca como muestra baja', () => {
  const r = razon(1, 1)
  assert.equal(r.valor, 100)
  assert.equal(esMuestraBaja(r), true)
  assert.equal(detalleMuestra(r), '1 de 1 · muestra baja')
  assert.equal(detalleMuestra(razon(30, 40)), '30 de 40')
  assert.equal(detalleMuestra(razon(0, 0)), 'sin muestra')
})

test('CSM, Alumnos y Bajas usan la razón con muestra y no calculan «den > 0 ? … : 0»', () => {
  for (const f of [
    'app/[tenant]/csm-events/page.tsx',
    'app/[tenant]/students/page.tsx',
    'app/[tenant]/drops/page.tsx',
  ]) {
    const src = leer(f)
    assert.match(src, /from '@\/lib\/metrics\/razon'/, `${f} no usa la razón con muestra`)
    assert.ok(!/\) \* 100 : 0\b/.test(src), `${f} calcula un porcentaje que cae a 0 sin muestra`)
  }
})

test('la recuperación de bajas se mide sobre lo RESUELTO, no sobre todas las solicitudes', () => {
  const src = leer('app/[tenant]/drops/page.tsx')
  assert.match(src, /razon\(recuperadas, recuperadas \+ perdidas\)/)
  // Y la pantalla no llama retención a lo que es recuperación de solicitudes.
  assert.doesNotMatch(src, /retención y churn/)
})
