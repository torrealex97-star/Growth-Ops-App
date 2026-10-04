import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('la proyección excluye canceladas y monitoring de lo "por cobrar"', () => {
  const s = leer('app/[tenant]/finanzas/analitica/proyeccion/page.tsx')
  assert.match(s, /\.not\('status', 'in', '\(collected,cancelled\)'\)/)
  assert.match(s, /\.eq\('is_monitoring', false\)/)
})

test('la morosidad calcula la deuda vencida sobre todas las cuotas, no sobre el periodo', () => {
  const s = leer('components/finanzas/InstallmentsMorosidadView.tsx')
  assert.match(s, /const overdue = rows\.filter\(\(r\) => isOverdue/)
  assert.doesNotMatch(s, /filteredRows\.filter\(\(r\) => isOverdue/)
})
