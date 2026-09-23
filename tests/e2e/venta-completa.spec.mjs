import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// SMOKE E2E — VENTA COMPLETA (pago completo con cobro y contrato)
//
// Recorre el flujo real de una venta full-pay: wizard de nueva venta desde cero (sin prefill)
// → selección manual de contacto → producto + plan de pago completo (3.000 €) → confirmación
// → cobro registrado (cash collected) → contrato de alumno generado → pipeline visible en el
// detalle. Si esto se rompe, se rompe la venta completa que cierra el negocio.
//
// NOTA DE DISEÑO: la verificación de identidad/documentos está POSPUESTA (petición del
// propietario, 22-sep): ya no es cortafuegos del contrato y el flujo va del cobro directo a
// generarlo. El test lo ejerce como lo hace un admin: cobrar → generar y enviar.
//
// IMPORTANTE: los specs NO re-ejecutan los fixtures. setup-tenant.mjs rota la contraseña del
// usuario QA (GoAdmin invalida TODAS sus sesiones al hacerlo), así que solo corre en el
// global-setup — antes del login — y deja los IDs en test-results/e2e-fixtures.json.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtures = JSON.parse(readFileSync(join(root, 'test-results', 'e2e-fixtures.json'), 'utf8'))
const tenant = fixtures.slug

test.describe('Venta completa — pago completo con cobro y contrato', () => {
  test('wizard completo: contacto → producto/plan → equipo → confirmar → cobro + contrato', async ({ page }) => {
    await page.goto(`/${tenant}/ventas/registro/nueva`)
    await expect(page.getByRole('heading', { name: 'Seleccionar Contacto' })).toBeVisible({ timeout: 20_000 })

    // Paso 1: selección MANUAL del contacto (sin prefill de URL).
    await page.getByPlaceholder('Buscar contacto por nombre o email...').fill('E2E Contacto Dos')
    const resultado = page.locator('button', { hasText: 'E2E Contacto Dos' }).first()
    await expect(resultado).toBeVisible({ timeout: 15_000 })
    await resultado.click()
    await expect(page.getByText('E2E Contacto Dos').first()).toBeVisible()

    // Paso 2: producto y plan de pago completo (3.000 €).
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.getByRole('heading', { name: 'Producto y Plan de Pago' })).toBeVisible()
    await page.locator('button', { hasText: 'E2E Producto' }).first().click()
    const planCompleto = page.locator('button', { hasText: 'E2E Pago completo' })
    await expect(planCompleto).toBeVisible({ timeout: 15_000 })
    await planCompleto.click()
    await expect(page.getByText('Resumen del plan')).toBeVisible()
    await expect(page.getByText('3.000,00 €').first()).toBeVisible()

    // Paso 3 (equipo, opcional) → paso 4 (confirmación).
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.getByRole('heading', { name: 'Equipo' })).toBeVisible()
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.getByRole('heading', { name: 'Confirmar Venta' })).toBeVisible()

    // Crear la venta: inserta venta + registra el cobro completo (cash collected).
    await page.getByRole('button', { name: 'Crear Venta' }).click()
    await page.waitForURL(/\/ventas\/registro\/[0-9a-f-]{36}$/, { timeout: 45_000 })

    // 1. Detalle de la venta: contacto e importe visibles (Intl es-ES: '3.000,00 €').
    await expect(page.getByText('E2E Contacto Dos').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('3.000,00 €').first()).toBeVisible()

    // 2. El cobro del pago completo quedó registrado (tab Cobros con contador ≥ 1).
    const tabCobros = page.getByRole('tab', { name: /Cobros/ })
    await expect(tabCobros).toBeVisible({ timeout: 15_000 })
    await expect(tabCobros).toContainText('1')
    await tabCobros.click()
    await expect(page.getByText('Total cobrado: 3.000,00 € / facturado 3.000,00 €')).toBeVisible()

    // 3. Generar y enviar el contrato del alumno (la verificación de identidad está pospuesta:
    //    ya no es cortafuegos). El click puede lanzar la generación y el botón re-renderizarse a
    //    busy antes de que Playwright dé el click por bueno: esperamos el RESULTADO (el pipeline
    //    del contrato), no el botón, así la carrera no deja el test colgado.
    await page.getByRole('tab', { name: 'Detalle' }).click()
    const panel = page.getByRole('tabpanel')
    await panel
      .getByRole('button', { name: 'Generar y enviar contrato' })
      .click({ timeout: 20_000 })
      .catch(() => {})
    await expect(page.getByText('Contrato enviado')).toBeVisible({ timeout: 30_000 })

    // 4. El contrato creado aparece en Contratos de alumnos ( vista global de la subcuenta).
    await page.goto(`/${tenant}/contratos`)
    await expect(page.getByRole('heading', { level: 1, name: /Contratos/ })).toBeVisible()
    await expect(page.getByText('E2E Contacto Dos').first()).toBeVisible({ timeout: 15_000 })
  })
})
