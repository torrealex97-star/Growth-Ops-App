import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { slug } = JSON.parse(readFileSync(join(root, 'test-results', 'e2e-fixtures.json'), 'utf8'))

test('visión de negocio: departamentos, selección de métricas y lectura móvil', async ({ page }) => {
  await page.goto(`/${slug}/unit-economics`)
  await expect(page.getByRole('heading', { name: 'Visión del negocio', exact: true })).toBeVisible()
  const selector = page.getByRole('group', { name: 'Métrica de Evolución del negocio', exact: true })
  await selector.getByRole('button', { name: 'Ventas', exact: true }).click()
  await expect(selector.getByRole('button', { name: 'Ventas', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(selector.getByRole('button', { name: 'Facturación y Cash Collected', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false'
  )
  await page.locator('#departamento-0').getByRole('button', { name: 'Semana', exact: true }).click()
  await expect(page.locator('#departamento-1').getByRole('button', { name: 'Semana', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  for (const name of ['Marketing', 'Asistencia', 'Ventas', 'Finanzas', 'Clientes']) {
    await expect(page.getByRole('heading', { name: new RegExp(name + '$'), level: 2 })).toHaveCount(1)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(selector).toBeVisible()
  const overflow = await page.locator('main').evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  expect(overflow).toBe(false)
})
