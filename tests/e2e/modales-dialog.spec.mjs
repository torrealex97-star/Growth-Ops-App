import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// SMOKE E2E — MODALES DE LA CASA (components/ui/dialog, Radix)
//
// REQ-UX-05 (lotes 3 y 4) migró los overlays caseros al Dialog canónico. Este spec fija el
// contrato que la migración promete, contra el servidor de producción-like del CI:
//
//   · abrir el modal es un <div role="dialog"> cuyo nombre accesible viene del DialogTitle
//     (aria-labelledby) — lo que un lector de pantalla anuncia al abrirlo
//   · Esc cierra (comportamiento que los overlays caseros no tenían)
//
// NOTA: @radix-ui/react-dialog@1.1.23 NO renderiza aria-modal (el trap de foco lo implementa
// con hideOthers, no con el atributo). No reintroducir ese assert: es un falso contrato.
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
  test('agendas: «Nueva agenda» abre dialog con nombre accesible y Esc lo cierra', async ({ page }) => {
    await page.goto(`/${tenant}/crm/agendas`)
    await expect(page.getByRole('heading', { name: 'Agendas', level: 1 })).toBeVisible()

    // getByRole('dialog', { name }) resuelve vía aria-labelledby → DialogTitle: comprueba
    // de una vez el rol Y que el título está enlazado para lectores de pantalla.
    const dialog = page.getByRole('dialog', { name: 'Nueva agenda' })
    await page.getByRole('button', { name: 'Nueva agenda' }).click()
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })

  test('gastos: «Nuevo gasto» abre dialog con nombre accesible y Esc lo cierra', async ({ page }) => {
    await page.goto(`/${tenant}/finanzas/gastos-facturas/gastos`)
    await expect(page.getByRole('heading', { name: 'Gastos', level: 1 })).toBeVisible()

    const dialog = page.getByRole('dialog', { name: 'Nuevo gasto' })
    await page.getByRole('button', { name: 'Nuevo gasto' }).click()
    await expect(dialog).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
  })
})
