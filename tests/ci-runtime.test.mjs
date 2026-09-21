import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const nextConfig = readFileSync(join(root, 'next.config.js'), 'utf8')

test('CI usa el runtime Node soportado', () => {
  assert.doesNotMatch(ci, /actions\/(checkout|setup-node)@v4/)
  assert.match(ci, /actions\/checkout@v7/)
  assert.match(ci, /actions\/setup-node@v7/)
  assert.match(ci, /node-version: 24/)
})

test('no vuelve un workflow de despliegue paralelo a la integración de Vercel', () => {
  // deploy.yml se borró en S0.4 (A0 §2.5): decía que la integración nativa no se pudo activar, cuando
  // es la que despliega cada commit, y le faltaban sus tres secrets. Sugería una vía de rollback que
  // no funcionaba. Si hace falta uno, que llegue con sus secrets y su porqué.
  assert.throws(() => readFileSync(join(root, '.github/workflows/deploy.yml')))
})

test('Next limita el trazado del artefacto a este repositorio', () => {
  assert.match(nextConfig, /outputFileTracingRoot: __dirname/)
})
