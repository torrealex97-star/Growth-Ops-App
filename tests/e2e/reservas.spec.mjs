import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// SMOKE E2E — RESERVAS (alta manual end-to-end)
//
// Recorre el flujo real de una reserva: diálogo "Nueva reserva" → wizard de venta al que se
// entra con ?contact=&product=&plan=reserva (paso 2 directo, plan de reserva preseleccionado)
// → confirmación con importe → cobro de la reserva → detalle de la venta → visible en Reservas.
//
// IMPORTANTE: los specs NO re-ejecutan los fixtures. setup-tenant.mjs rota la contraseña del
// usuario QA (GoAdmin invalida TODAS sus sesiones al hacerlo), así que solo corre en el
// global-setup — antes del login — y deja los IDs en test-results/e2e-fixtures.json.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtures = JSON.parse(readFileSync(join(root, 'test-results', 'e2e-fixtures.json'), 'utf8'))
const tenant = fixtures.slug

test.describe('Reservas — alta manual', () => {
  test('flujo completo: diálogo → wizard (plan de reserva preseleccionado) → cobro → detalle', async ({ page }) => {
    await page.goto(`/${tenant}/ventas/reservas`)
    await expect(page.getByRole('heading', { name: 'Reservas', level: 1 })).toBeVisible()

    // 1. Diálogo de alta manual: producto + contacto del fixture.
    await page.getByRole('button', { name: 'Nueva reserva' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'E2E Producto' }).click()

    await dialog.getByPlaceholder('Buscar por nombre o email...').fill('E2E Contacto')
    const resultadoContacto = dialog.locator('button', { hasText: 'E2E Contacto' }).first()
    await expect(resultadoContacto).toBeVisible({ timeout: 15_000 })
    await resultadoContacto.click()
    await expect(dialog.getByText('Contacto seleccionado')).toBeVisible()

    // 2. Continuar → wizard directo en el paso 2 (?contact= activa setStep(2) en el prefill),
    //    con el producto cargado y el plan de reserva PRESELECCIONADO (?plan=reserva).
    await dialog.getByRole('button', { name: 'Continuar' }).click()
    await page.waitForURL('**/ventas/registro/nueva?**')
    await expect(page.getByRole('heading', { name: 'Producto y Plan de Pago' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('E2E Producto').first()).toBeVisible()
    const planCard = page.locator('button', { hasText: 'E2E Reserva' })
    await expect(planCard).toHaveClass(/border-brand-500/) // preseleccionado

    // 3. Paso 3 (equipo, opcional) → paso 4 (confirmación).
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.getByRole('heading', { name: 'Equipo' })).toBeVisible()
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.getByRole('heading', { name: 'Confirmar Venta' })).toBeVisible()

    // Importe de la reserva: 300 € (botón rápido del paso 4) y crear la venta
    // (inserta venta + registra el cobro + genera comisiones vía RLS admin).
    await page.getByRole('button', { name: '300€' }).click()
    await page.getByRole('button', { name: 'Crear Venta' }).click()
    await page.waitForURL('**/ventas/registro/**', { timeout: 30_000 })
    await page.waitForURL((u) => !u.pathname.endsWith('/nueva'), { timeout: 30_000 })

    // 4. Detalle de la venta: contacto e importe visibles (Intl es-ES: '300,00 €').
    await expect(page.getByText('E2E Contacto').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('300,00 €').first()).toBeVisible()
  })

  test('la reserva creada aparece como abierta en Reservas', async ({ page }) => {
    await page.goto(`/${tenant}/ventas/reservas`)
    await expect(page.getByRole('heading', { name: 'Reservas', level: 1 })).toBeVisible()

    // Las reservas abiertas se pintan como tarjetas (no tabla). Otros specs (reserva desde
    // cero) crean reservas del MISMO producto/contacto, así que localizamos la de ESTE flujo
    // por estructura: la primera tarjeta del listado de abiertas tiene los tres botones, y el
    // KPI de abiertas coincide con la primera reserva ordenada por fecha (la más reciente).
    await expect(page.getByText('Reservas abiertas')).toBeVisible()
    await expect(page.getByText(/pagó .* de reserva/).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Producto: E2E Producto').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Completar pago' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Editar reserva' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Eliminar reserva' }).first()).toBeVisible()
  })
})
