import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dashboard = readFileSync(new URL('../app/[tenant]/dashboard/page.tsx', import.meta.url), 'utf8')
const unitEconomics = readFileSync(new URL('../app/[tenant]/unit-economics/page.tsx', import.meta.url), 'utf8')

test('las cargas pesadas se cancelan al abandonar dashboard y visión del negocio', () => {
  for (const [nombre, codigo, minimo] of [
    ['dashboard', dashboard, 12],
    ['visión del negocio', unitEconomics, 9],
  ]) {
    assert.match(codigo, /const cancelar = new AbortController\(\)/, `${nombre} no crea un AbortController`)
    assert.ok(
      codigo.split('.abortSignal(cancelar.signal)').length - 1 >= minimo,
      `${nombre} no propaga la cancelación a todas sus consultas principales`
    )
    assert.match(
      codigo,
      /return \(\) => \{\s*mounted = false\s*cancelar\.abort\(\)/,
      `${nombre} no cancela al desmontar`
    )
  }

  assert.match(
    dashboard,
    /commissions\/future`, \{ signal: cancelar\.signal \}/,
    'la petición adicional de comisiones debe cancelarse con la pantalla'
  )
})

test('los filtros costosos usan valores diferidos para no bloquear el siguiente clic', () => {
  assert.match(dashboard, /useDeferredValue\(periodoActual\)/)
  assert.match(unitEconomics, /useDeferredValue\(filtrosActuales\)/)
  assert.match(unitEconomics, /filtrosDiferidos\.cuentaSel/)
  assert.match(unitEconomics, /filtrosDiferidos\.atribucion/)
})
