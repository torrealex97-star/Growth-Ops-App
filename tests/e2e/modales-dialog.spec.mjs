import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// SMOKE E2E — MODALES DE LA CASA (components/ui/dialog, Radix)
//
// REQ-UX-05 (lotes 3 y 4) migró los overlays caseros al Dialog canónico. Este spec fija el
// contrato que la migración promete, contra el servidor de producción-like del CI:
//
//   · abrir el modal es <dialog> con aria-modal (foco atrapado y click-fuera gratis)
//   · Esc cierra (comportamiento que los overlays caseros no tenían)
//
// Solo lectura: se abre y se cierra; NADA se guarda. Dos pantallas a propósito: Agenda
// («Nueva agenda», Dialog controlado siempre montado) y Gastos («Nuevo gasto», Dialog
// condicional {showNew && ...}) — cubren los dos patrones de integración del lote 4.
//
// Fixtures: setup-tenant.mjs deja los IDs en test-results/e2e-fixtures.json (solo el slug);
// la sesión la monta el global-setup con storageState.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtures = JSON.parse(readFileSync(join(root, 'test-results', 'e2e-fixtures.json'), 'utf8'))
const tenant = fixtures.slug

test.describe('Modales de la casa — contrato Radix', () => {
  test('agendas: «Nueva agenda» abre dialog con aria-modal y Esc lo cierra', async ({ page }) => {
    await page.goto(`/${tenant}/crm/agendas`)
    await expect(page.getByRole('heading', { name: 'Agendas', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Nueva agenda' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    await expect(dialog.getByRole('heading', { name: 'Nueva agenda' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test('gastos: «Nuevo gasto» abre dialog con aria-modal y Esc lo cierra', async ({ page }) => {
    await page.goto(`/${tenant}/finanzas/gastos-facturas/gastos`)
    await expect(page.getByRole('heading', { name: 'Gastos', level: 1 })).toBeVisible()

    await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')

    await expect(dialog.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })
})
