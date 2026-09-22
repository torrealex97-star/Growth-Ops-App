import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// SMOKE E2E — RESERVA DESDE CERO (sin contacto preseleccionado)
//
// Recorre la alta de una reserva partiendo del diálogo "Nueva reserva" SIN elegir contacto
// (el botón es opcional) → wizard en el paso 1 → selección manual del contacto → el plan de
// reserva del producto llega PRESELECCIONADO (?plan=reserva) → confirmación → cobro → detalle.
// Complementa el flujo con prefill de reservas.spec.mjs: cubre el paso 1 manual y el prefill
// de producto con plan sin contacto.
//
// IMPORTANTE: los specs NO re-ejecutan los fixtures. setup-tenant.mjs rota la contraseña del
// usuario QA (GoAdmin invalida TODAS sus sesiones al hacerlo), así que solo corre en el
// global-setup — antes del login — y deja los IDs en test-results/e2e-fixtures.json.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtures = JSON.parse(readFileSync(join(root, 'test-results', 'e2e-fixtures.json'), 'utf8'))
const tenant = fixtures.slug

test.describe('Reservas — alta desde cero (sin contacto preseleccionado)', () => {
  test('diálogo solo con producto → wizard paso 1 manual → plan de reserva preseleccionado → crear', async ({
    page,
  }) => {
    await page.goto(`/${tenant}/ventas/reservas`)
    await expect(page.getByRole('heading', { name: 'Reservas', level: 1 })).toBeVisible()

    // 1. Diálogo de alta manual: SOLO producto, sin buscar contacto (es opcional).
    await page.getByRole('button', { name: 'Nueva reserva' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', { name: 'E2E Producto' }).click()

    // 2. Continuar → wizard en el PASO 1 (sin ?contact= el prefill no salta al paso 2).
    await dialog.getByRole('button', { name: 'Continuar' }).click()
    await page.waitForURL('**/ventas/registro/nueva?**')
    await expect(page.getByRole('heading', { name: 'Seleccionar Contacto' })).toBeVisible({ timeout: 20_000 })

    // 3. Selección manual del segundo contacto del fixture.
    await page.getByPlaceholder('Buscar contacto por nombre o email...').fill('E2E Contacto Dos')
    const resultado = page.locator('button', { hasText: 'E2E Contacto Dos' }).first()
    await expect(resultado).toBeVisible({ timeout: 15_000 })
    await resultado.click()
    await expect(page.getByText('E2E Contacto Dos').first()).toBeVisible()

    // 4. Paso 2: el producto ya viene cargado (?product=) y el plan de reserva PRESELECCIONADO
    //    (?plan=reserva sin reservationId) — el prefill no pisa la elección del usuario, solo
    //    marca el plan cuando viene de alta de reserva.
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.getByRole('heading', { name: 'Producto y Plan de Pago' })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('E2E Producto').first()).toBeVisible()
    const planCard = page.locator('button', { hasText: 'E2E Reserva' })
    await expect(planCard).toHaveClass(/border-brand-500/, { timeout: 15_000 }) // preseleccionado

    // 5. Paso 3 (equipo, opcional) → paso 4 (confirmación).
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.getByRole('heading', { name: 'Equipo' })).toBeVisible()
    await page.getByRole('button', { name: 'Siguiente' }).click()
    await expect(page.getByRole('heading', { name: 'Confirmar Venta' })).toBeVisible()

    // 6. Importe de la reserva: 300 € (botón rápido) y crear la venta
    //    (inserta venta reserva + registra el cobro de la reserva vía RLS admin).
    await page.getByRole('button', { name: '300€' }).click()
    await page.getByRole('button', { name: 'Crear Venta' }).click()
    await page.waitForURL(/\/ventas\/registro\/[0-9a-f-]{36}$/, { timeout: 45_000 })

    // 7. Detalle: contacto e importe visibles (Intl es-ES: '300,00 €').
    await expect(page.getByText('E2E Contacto Dos').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('300,00 €').first()).toBeVisible()
  })

  test('la reserva creada aparece como abierta en Reservas', async ({ page }) => {
    await page.goto(`/${tenant}/ventas/reservas`)
    await expect(page.getByRole('heading', { name: 'Reservas', level: 1 })).toBeVisible()

    // Las reservas abiertas se pintan como tarjetas. Con las corridas de los otros specs hay
    // varias abiertas: verificamos la de ESTE flujo por su titular único (E2E Contacto Dos
    // solo reserva desde este spec) sin depender de índices.
    await expect(page.getByText('Reservas abiertas')).toBeVisible()
    const tarjeta = page.locator('div.bg-card', { hasText: 'E2E Contacto Dos pagó 300,00 € de reserva' }).first()
    await expect(tarjeta).toBeVisible({ timeout: 15_000 })
    await expect(tarjeta.getByText('Producto: E2E Producto')).toBeVisible()
    await expect(tarjeta.getByRole('button', { name: 'Completar pago' })).toBeVisible()
    await expect(tarjeta.getByRole('button', { name: 'Editar reserva' })).toBeVisible()
    await expect(tarjeta.getByRole('button', { name: 'Eliminar reserva' })).toBeVisible()
  })
})
