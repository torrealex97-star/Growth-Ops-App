import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const codigo = readFileSync(join(root, 'components/os/Header.tsx'), 'utf8')

test('las alertas del Growth Brief se cargan solo al abrir Notificaciones', () => {
  assert.match(codigo, /if \(!notificationsOpen \|\| metricAlertsLoaded\) return/)
  assert.match(codigo, /\/metricas\/brief/)
  assert.ok(
    codigo.indexOf('if (!notificationsOpen || metricAlertsLoaded) return') < codigo.indexOf('/metricas/brief'),
    'la petición tiene que quedar detrás de la apertura del popover'
  )
})

test('la petición de alertas tiene cancelación, error visible y reintento', () => {
  assert.match(codigo, /new AbortController\(\)/)
  assert.match(codigo, /signal: ac\.signal/)
  assert.match(codigo, /metricAlertsError/)
  assert.match(codigo, /Reintentar/)
})

test('cada alerta enlaza al panel que explica su cálculo', () => {
  assert.match(codigo, /href={`\/\$\{tenant\}\/unit-economics`}/)
  assert.match(codigo, /alerta\.titulo/)
  assert.match(codigo, /alerta\.detalle/)
})
