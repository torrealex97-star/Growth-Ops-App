import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { cuentaUnicaActiva } from '../lib/meta/accounts.ts'

test('una sola cuenta activa se selecciona sola', () => {
  assert.equal(cuentaUnicaActiva([{ id: 'act_1', status: 1 }]), 'act_1')
  assert.equal(cuentaUnicaActiva([{ id: '123' }]), 'act_123')
})

test('varias cuentas activas, ninguna, o una activa entre inactivas', () => {
  assert.equal(
    cuentaUnicaActiva([
      { id: 'act_1', status: 1 },
      { id: 'act_2', status: 1 },
    ]),
    null
  )
  assert.equal(cuentaUnicaActiva([]), null)
  assert.equal(
    cuentaUnicaActiva([
      { id: 'act_1', status: 1 },
      { id: 'act_2', status: 2 },
    ]),
    'act_1'
  )
  assert.equal(cuentaUnicaActiva([{ id: 'act_2', status: 2 }]), null)
})

test('solo se autoselecciona al guardar un token nuevo sin cuenta elegida', () => {
  const s = readFileSync(
    new URL('../app/api/[tenant]/evergreen/settings/integraciones/route.ts', import.meta.url),
    'utf8'
  )
  assert.match(s, /updates\.META_ACCESS_TOKEN\?\.trim\(\) && !updates\.META_AD_ACCOUNT_ID\?\.trim\(\)/)
  assert.match(s, /parseAccountIds\(cfgActual\.META_AD_ACCOUNT_ID\)\.length === 0/)
})
