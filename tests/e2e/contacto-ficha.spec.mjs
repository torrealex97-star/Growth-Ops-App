import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// SMOKE E2E — FICHA DE CONTACTO (info-first + campos personalizados)
//
// 1. La ficha abre en la pestaña "Información" (estilo top CRMs), no en Timeline.
// 2. Los campos personalizados de la subcuenta se ven, se editan y se guardan
//    contra contacts.custom_fields (PATCH /contacts/[id]).
// 3. El filtro de la lista por campo personalizado encuentra el contacto.
//
// IMPORTANTE: los specs NO re-ejecutan los fixtures. setup-tenant.mjs rota la contraseña
// del usuario QA (y GoAdmin invalida TODAS sus sesiones al hacerlo), así que solo corre
// en el global-setup — antes del login — y deja los IDs en test-results/e2e-fixtures.json.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtures = JSON.parse(readFileSync(join(root, 'test-results', 'e2e-fixtures.json'), 'utf8'))
const tenant = fixtures.slug

test.describe('Ficha de contacto — info-first y campos personalizados', () => {
  test('la ficha abre en Información con datos y campos personalizados visibles', async ({ page }) => {
    await page.goto(`/${tenant}/crm/contactos/${fixtures.contactId}`)

    // Tabs presentes y "Información" activa por defecto (data-state de Radix).
    const tabInfo = page.getByRole('tab', { name: 'Información' })
    const tabTimeline = page.getByRole('tab', { name: 'Timeline' })
    await expect(tabInfo).toBeVisible()
    await expect(tabTimeline).toBeVisible()
    await expect(tabInfo).toHaveAttribute('data-state', 'active')

    // Datos del contacto visibles SIN tocar nada (info-first). El email aparece en la
    // cabecera Y en la ficha: strict mode exige .first().
    await expect(page.getByText('e2e-contacto@test.local').first()).toBeVisible()

    // Bloque de campos personalizados con las defs del fixture.
    await expect(page.getByText('Campos personalizados')).toBeVisible()
    await expect(page.getByText('E2E Campo Texto').first()).toBeVisible()
    await expect(page.getByText('E2E Campo Booleano').first()).toBeVisible()
  })

  test('editar un campo personalizado y guardarlo persiste en la ficha', async ({ page }) => {
    await page.goto(`/${tenant}/crm/contactos/${fixtures.contactId}`)
    await expect(page.getByText('Campos personalizados')).toBeVisible()

    const valor = `valor-e2e-${Date.now()}`

    // El input va justo debajo de la etiqueta de la def (label → input hermano).
    const campo = page.locator('div.bg-card', { hasText: 'Campos personalizados' }).first()
    const etiqueta = campo.locator('dt', { hasText: 'E2E Campo Texto' })
    const input = etiqueta.locator('xpath=following-sibling::input[1]')
    await input.fill(valor)

    await page.getByRole('button', { name: 'Guardar campos' }).click()
    // El PATCH es async: el toast de éxito es la señal fiable de que terminó.
    await expect(page.getByText('Campos personalizados guardados')).toBeVisible({ timeout: 15_000 })

    // Recargar: el valor debe persistir.
    await page.reload()
    await expect(page.getByText('Campos personalizados')).toBeVisible()
    const etiquetaTrasReload = page
      .locator('div.bg-card', { hasText: 'Campos personalizados' })
      .first()
      .locator('dt', { hasText: 'E2E Campo Texto' })
    const inputTrasReload = etiquetaTrasReload.locator('xpath=following-sibling::input[1]')
    await expect(inputTrasReload).toHaveValue(valor)
  })

  test('el filtro de la lista por campo personalizado encuentra el contacto', async ({ page }) => {
    await page.goto(`/${tenant}/crm/contactos`)
    await expect(page.getByRole('button', { name: 'Nuevo contacto' })).toBeVisible()

    // El dropdown de campos es hover-only (group-hover): hover sobre el trigger del filtro
    // (el que muestra el label de la def activa) despliega el menú con las defs.
    const triggerFiltro = page.locator('div.group > button', { hasText: 'Campos' }).first()
    await triggerFiltro.hover()
    const opcion = page.locator('div.group div.absolute button', { hasText: 'E2E Campo Texto' }).first()
    await opcion.click()

    // Refetch tras el filtro: el contacto fixture debe aparecer.
    const fila = page.locator('tbody tr', { hasText: 'e2e-contacto@test.local' })
    await expect(fila).toBeVisible({ timeout: 15_000 })
  })
})
