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
  // El run del 25-sep (CI de main) murió aquí: waitForURL agotó 30 s tras el submit sin que
  // el árbol cambiara — el MISMO árbol pasó el mismo E2E en la PR siguiente (flakiness
  // transitorio: cold start de la función, latencia de Supabase Auth o un lento RSC del
  // dashboard). No es un fallo determinista del código, así que el setup reintenta el login
  // completo antes de rendirse y, si falla del todo, deja captura + errores de consola en
  // test-results/ para diagnosticar sin volver a adivinar. El password nunca se imprime.
  const statePath = join(root, 'test-results', 'e2e-auth.json')
  mkdirSync(dirname(statePath), { recursive: true })
  const INTENTOS = 2
  let ultimoError
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const browser = await chromium.launch()
    const page = await browser.newPage()
    const erroresConsola = []
    page.on('console', (m) => {
      if (m.type() === 'error') erroresConsola.push(m.text())
    })
    page.on('pageerror', (e) => erroresConsola.push(String(e)))
    try {
      await page.goto(`${baseURL}/${fixtures.slug}/login`, { waitUntil: 'domcontentloaded' })

      // El login comprueba la subcuenta con una RPC antes de mostrar el formulario.
      await page.waitForSelector('#email', { timeout: 30_000 })
      await page.fill('#email', fixtures.email)
      await page.fill('#password', process.env.E2E_PASSWORD)
      await page.click('button[type="submit"]')

      await page.waitForURL(`**/${fixtures.slug}/dashboard`, { timeout: 60_000 })
      await page.waitForLoadState('networkidle').catch(() => {})

      // ── 3. storageState + fixtures ───────────────────────────────────────────
      await page.context().storageState({ path: statePath })
      writeFileSync(join(root, 'test-results', 'e2e-fixtures.json'), JSON.stringify(fixtures))
      ultimoError = undefined
      break
    } catch (err) {
      ultimoError = err
      if (intento < INTENTOS) {
        console.log(
          `[e2e] login intento ${intento}/${INTENTOS} falló (${err instanceof Error ? err.message.split('\n')[0] : String(err)}); reintentando…`
        )
      } else {
        const shot = join(root, 'test-results', 'e2e-login-failure.png')
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
        writeFileSync(
          join(root, 'test-results', 'e2e-login-failure.log'),
          JSON.stringify({ error: String(err), erroresConsola: erroresConsola.slice(0, 20) }, null, 2)
        )
      }
    } finally {
      await browser.close()
    }
  }
  if (ultimoError) throw ultimoError
  console.log('[e2e] login OK y storageState guardado')
}
