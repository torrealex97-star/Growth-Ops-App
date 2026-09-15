import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const deploy = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8')
const nextConfig = readFileSync(join(root, 'next.config.js'), 'utf8')

test('CI y deploy usan el mismo runtime Node soportado', () => {
  assert.doesNotMatch(ci, /actions\/(checkout|setup-node)@v4/)
  assert.doesNotMatch(deploy, /actions\/(checkout|setup-node)@v4/)
  assert.match(ci, /actions\/checkout@v7/)
  assert.match(ci, /actions\/setup-node@v7/)
  assert.match(deploy, /actions\/checkout@v7/)
  assert.match(deploy, /actions\/setup-node@v7/)
  assert.match(ci, /node-version: 24/)
  assert.match(deploy, /node-version: 24/)
})

test('Next limita el trazado del artefacto a este repositorio', () => {
  assert.match(nextConfig, /outputFileTracingRoot: __dirname/)
})
