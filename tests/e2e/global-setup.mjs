// Global setup de Playwright: prepara el tenant QA, hace login REAL por la UI y
// guarda el storageState que reutilizarán todos los specs.
//
// 1. fixtures idempotentes (scripts/e2e/setup-tenant.mjs) — service role, solo local/CI.
// 2. login con email/contraseña en /{slug}/login (misma ruta que usa cualquier usuario).
// 3. storageState → test-results/e2e-auth.json + fixtures en test-results/e2e-fixtures.json.
//
// Credenciales: el password SOLO existe en env (E2E_PASSWORD). Nunca se imprime ni se
// persiste en el repo; el JSON de fixtures solo contiene IDs y el email del usuario QA.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// dotenv plano NO lee .env.local (eso lo hace Next): cargar ambos, .env.local con prioridad.
dotenv.config({ path: join(root, '.env.local') })
dotenv.config()
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100'

export default async function globalSetup() {
  if (!process.env.E2E_PASSWORD) {
    throw new Error('E2E_PASSWORD no está definido (local: .env.local; CI: secrets del repo)')
  }

  // ── 1. Fixtures idempotentes ───────────────────────────────────────────────
  const out = execFileSync('node', ['scripts/e2e/setup-tenant.mjs', '--reset'], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
  })
  const fixtures = JSON.parse(out.slice(out.indexOf('{')))
  console.log(`[e2e] tenant ${fixtures.slug} listo (${fixtures.contactId.slice(0, 8)}…)`)

  // ── 2. Login real por la UI ────────────────────────────────────────────────
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`${baseURL}/${fixtures.slug}/login`, { waitUntil: 'domcontentloaded' })

  // El login comprueba la subcuenta con una RPC antes de mostrar el formulario.
  await page.waitForSelector('#email', { timeout: 30_000 })
  await page.fill('#email', fixtures.email)
  await page.fill('#password', process.env.E2E_PASSWORD)
  await page.click('button[type="submit"]')

  await page.waitForURL(`**/${fixtures.slug}/dashboard`, { timeout: 30_000 })
  await page.waitForLoadState('networkidle').catch(() => {})

  // ── 3. storageState + fixtures ─────────────────────────────────────────────
  const statePath = join(root, 'test-results', 'e2e-auth.json')
  mkdirSync(dirname(statePath), { recursive: true })
  await page.context().storageState({ path: statePath })
  writeFileSync(join(root, 'test-results', 'e2e-fixtures.json'), JSON.stringify(fixtures))
  await browser.close()
  console.log('[e2e] login OK y storageState guardado')
}
