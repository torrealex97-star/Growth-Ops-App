import { defineConfig, devices } from '@playwright/test'

// Smoke E2E de GrowthOps: flujos críticos de negocio contra el servidor real.
//
//   npm run test:e2e          → build prod + next start + specs
//   npm run test:e2e:headed   → mismo, con navegador visible
//
// Entorno requerido (local: .env.local; CI: secrets del repo):
//   NEXT_PUBLIC_SUPABASE_URL · NEXT_PUBLIC_SUPABASE_ANON_KEY · SUPABASE_SERVICE_ROLE_KEY
//   E2E_PASSWORD  → contraseña del usuario admin@qa-e2e.test (los fixtures NO la fijan en el repo)
//
// El server lo levanta Playwright (webServer): build producción si no existe y `next start`
// en 3100 (puerto aparte para no chocar con dev servers locales). Si E2E_BASE_URL está puesto,
// NO se levanta server: se asume uno ya corriendo (útil en CI con servidor propio).

const PORT = 3100
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`
const tieneServidorPropio = !!process.env.E2E_BASE_URL

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.mjs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Un solo worker: los specs tocan el mismo tenant QA y el orden importa (reservas → fichas).
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['json', { outputFile: 'test-results/e2e.json' }]] : [['list']],
  outputDir: 'test-results/e2e-artifacts',
  use: {
    baseURL,
    storageState: 'test-results/e2e-auth.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: tieneServidorPropio
    ? undefined
    : {
        command: 'npm run start -- --port 3100',
        // La home pública como sonda (no hay /api/health): 200 = servidor listo.
        url: `http://localhost:${PORT}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
})
