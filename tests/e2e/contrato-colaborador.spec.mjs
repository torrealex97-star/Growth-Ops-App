import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// SMOKE E2E — CONTRATOS DE EQUIPO: adjuntar firmado externamente
//
// Cubre el cierre del alta de colaboradores cuando la firma ocurre FUERA de la app
// (el colaborador devuelve un PDF ya firmado): desde 'Contratos de equipo' se adjunta
// el PDF, el contrato pasa a 'firmado' con su PDF descargable y el perfil del
// colaborador queda ACTIVO sin intervención adicional — la misma cadena que cierra la
// firma nativa de /firmar/[token].
//
// Fixtures (setup-tenant.mjs): perfil 'E2E-COLAB' en 'pending_contract' + contrato de
// equipo 'E2E Contrato Colaborador' en 'enviado' con token fresco. El teardown borra
// los contratos y el setup los recrea: cada corrida parte de un estado limpio.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtures = JSON.parse(readFileSync(join(root, 'test-results', 'e2e-fixtures.json'), 'utf8'))
const tenant = fixtures.slug

// PDF mínimo válido de una página en blanco. El endpoint de attach valida contentType
// y tamaño, no el contenido del documento. En memoria: no se versionan binarios de prueba.
const PDF_MINIMO = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'trailer<</Size 4/Root 1 0 R>>\n' +
    '%%EOF',
  'latin1'
)

test.describe('Contratos de equipo — adjuntar firmado externamente', () => {
  test('el PDF adjuntado firma el contrato y activa al colaborador pendiente', async ({ page }) => {
    // 1. Estado inicial del fixture: el colaborador está en 'Contrato pendiente'.
    await page.goto(`/${tenant}/marketing/afiliados/afiliados`)
    const filaColab = page.locator('tbody tr', { hasText: 'E2E-COLAB' })
    await expect(filaColab).toBeVisible()
    await expect(filaColab.locator('select')).toHaveValue('pending_contract')

    // 2. Contratos de equipo: la fila del contrato en 'enviado' ofrece 'Adjuntar firmado'
    //    (y el enlace de firma nativa, que desaparecerá al firmar).
    await page.goto(`/${tenant}/contratos/equipo`)
    await expect(page.getByRole('heading', { name: 'Contratos de equipo', level: 1 })).toBeVisible()
    const filaContrato = page.locator('div.divide-y > div', { hasText: 'E2E Contrato Colaborador' })
    await expect(filaContrato.getByText('enviado', { exact: true })).toBeVisible()
    const botonAdjuntar = filaContrato.getByRole('button', { name: 'Adjuntar firmado' })
    await expect(botonAdjuntar).toBeVisible()

    // 3. Adjuntar el PDF firmado. Se abre el selector de ficheros real del componente
    //    (filechooser) y se entrega el PDF: mismo camino que el usuario con su archivo.
    const [elegidor] = await Promise.all([page.waitForEvent('filechooser'), botonAdjuntar.click()])
    await elegidor.setFiles({
      name: 'contrato-firmado-externo.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_MINIMO,
    })

    // 4. El contrato queda 'firmado' con PDF descargable y ya no se puede re-adjuntar.
    await expect(filaContrato.getByText('firmado', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(filaContrato.getByRole('button', { name: 'Adjuntar firmado' })).toHaveCount(0)
    await expect(filaContrato.getByRole('button', { name: 'PDF' })).toBeVisible()

    // 5. Cierre de la cadena: el perfil del colaborador se activó SOLO.
    await page.goto(`/${tenant}/marketing/afiliados/afiliados`)
    await expect(page.locator('tbody tr', { hasText: 'E2E-COLAB' }).locator('select')).toHaveValue('active')
  })
})
