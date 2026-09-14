import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  isAccountSelected,
  normalizeAccountId,
  parseAccountIds,
  serializeAccountIds,
  toggleAccountId,
} from '../../lib/meta/accounts.ts'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('acepta varias cuentas en cualquier separador y normaliza el prefijo', () => {
  assert.deepEqual(parseAccountIds('act_1, 2;3\nact_4'), ['act_1', 'act_2', 'act_3', 'act_4'])
  assert.deepEqual(parseAccountIds(''), [])
  assert.deepEqual(parseAccountIds(null), [])
  assert.equal(normalizeAccountId(' 99 '), 'act_99')
  // Sin duplicados, aunque se pegue la misma cuenta con y sin prefijo.
  assert.deepEqual(parseAccountIds('act_7,7'), ['act_7'])
})

test('la selección se compara por id, no por substring', () => {
  // BUG reproducido: con "act_12" guardado, la UI marcaba también "act_123", porque comparaba con
  // `.includes()` sobre el texto crudo. Elegir una cuenta marcaba visualmente otra.
  assert.equal('act_12'.includes('act_123'), false)
  assert.equal('act_123'.includes('act_12'), true) // el substring que causaba el falso positivo
  assert.equal(isAccountSelected('act_12', 'act_123'), false)
  assert.equal(isAccountSelected('act_123', 'act_123'), true)
  assert.equal(isAccountSelected('act_1,act_2', 'act_2'), true)
  assert.equal(isAccountSelected('', 'act_2'), false)
})

test('toggle añade y quita sin perder el resto de la selección', () => {
  assert.equal(toggleAccountId('act_1,act_2', 'act_3'), 'act_1,act_2,act_3')
  assert.equal(toggleAccountId('act_1,act_2,act_3', 'act_2'), 'act_1,act_3')
  assert.equal(toggleAccountId('act_1', 'act_1'), '')
  // Sin prefijo también: la misma cuenta escrita de otra forma no se duplica.
  assert.equal(toggleAccountId('act_1', '1'), '')
  assert.equal(serializeAccountIds(['5', 'act_5', '6']), 'act_5,act_6')
})

test('la pantalla de Integraciones permite marcar VARIAS cuentas', () => {
  const ui = read('../../app/[tenant]/settings/integraciones/page.tsx')
  // BUG reproducido: era <input type="radio"> con un name compartido, así que el navegador
  // desmarcaba la anterior y solo se podía sincronizar una cuenta.
  assert.ok(!/name="meta-account"/.test(ui), 'el radio group impedía elegir varias cuentas')
  assert.match(ui, /type="checkbox"\s*\n\s*checked=\{elegida\}/)
  assert.match(ui, /toggleAccountId\(drafts\.META_AD_ACCOUNT_ID, acc\.id\)/)
  assert.match(ui, /Seleccionar todas/)
})

test('la UI y el servidor usan la MISMA definición de cuenta seleccionada', () => {
  const ui = read('../../app/[tenant]/settings/integraciones/page.tsx')
  assert.match(ui, /from '@\/lib\/meta\/accounts'/)
  // Y el cliente de Meta no mantiene una copia propia de la función.
  const client = read('../../lib/meta/client.ts')
  assert.match(client, /export \{ parseAccountIds \} from '@\/lib\/meta\/accounts'/)
  assert.ok(!/function normalizeAccountId/.test(client), 'normalizeAccountId debe vivir solo en lib/meta/accounts.ts')
})

test('sin cuentas marcadas se sincronizan todas las accesibles, y eso no borra histórico', () => {
  const client = read('../../lib/meta/client.ts')
  // Lista vacía = todas: es la regla que documenta la UI, y tiene que seguir siendo la del servidor.
  assert.match(client, /const wantAll = explicit\.length === 0/)
  // Y una cuenta que deja de estar disponible no dispara ningún borrado.
  assert.ok(!/\.delete\(\)/.test(client), 'el cliente de Meta no debe borrar nada')
  const sync = read('../../lib/meta/sync.ts')
  assert.ok(!/from\('campaigns'\)[\s\S]{0,80}\.delete\(/.test(sync), 'la sync no debe borrar campañas históricas')
})
