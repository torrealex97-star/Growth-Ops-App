import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

function walk(path) {
  const absolute = join(root, path)
  return readdirSync(absolute).flatMap((entry) => {
    const relative = join(path, entry)
    return statSync(join(root, relative)).isDirectory() ? walk(relative) : [relative]
  })
}

test('las funciones respetan el presupuesto Free Tier y Vercel evita builds prescindibles', () => {
  const config = JSON.parse(read('vercel.json'))
  assert.equal(config.fluid, true)
  assert.equal(config.functions['app/api/**/*.ts'].maxDuration, 60)
  assert.equal(config.git.deploymentEnabled['dependabot/**'], false)
  assert.match(config.ignoreCommand, /docs\/\*\*/)

  for (const path of walk('app/api').filter((path) => /route\.ts$/.test(path))) {
    const source = read(path)
    const declaration = source.match(/export const maxDuration = (\d+)/)
    if (declaration) assert.ok(Number(declaration[1]) <= 60, `${path} permite ${declaration[1]} segundos`)
  }
})

// Regresión (27-sep): la versión anterior de ignoreCommand solo saltaba el build cuando
// `$VERCEL_ENV != "production"` — pero este proyecto despliega CADA push a `main` como target
// `production` (confirmado contra el historial real de deploys en Vercel), así que esa condición
// nunca se cumplía y TODO commit a main construía en Vercel, incluidos los `docs(handoff): ...`
// que no tocan una sola línea de código. Con el volumen de commits de relevo entre agentes de este
// repo, eso es lo que estaba llenando Vercel de deploys — el aserto anterior (`assert.match(...,
// /VERCEL_ENV.*production/)`) fijaba justo esa condición rota como "correcta" porque solo miraba
// la forma del string, nunca el comportamiento real. Este test ejecuta el propio ignoreCommand
// contra un repo git de usar y tirar, como lo ejecutaría Vercel de verdad.
test('vercel.json: ignoreCommand salta el build para commits que solo tocan docs/markdown (en cualquier entorno)', () => {
  const { ignoreCommand } = JSON.parse(read('vercel.json'))
  const dir = mkdtempSync(join(tmpdir(), 'ignore-command-'))
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
    git('init', '--quiet')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'test')

    writeFileSync(join(dir, 'app.ts'), 'export const x = 1\n')
    writeFileSync(join(dir, 'README.md'), '# init\n')
    git('add', '-A')
    git('commit', '--quiet', '-m', 'init')

    // Commit 1: solo toca docs/ y un .md en la raíz — debe SALTAR el build (exit 0).
    writeFileSync(join(dir, 'README.md'), '# actualizado\n')
    git('add', '-A')
    git('commit', '--quiet', '-m', 'docs(handoff): solo texto')
    let skipExit = 0
    try {
      execFileSync('bash', ['-c', ignoreCommand], { cwd: dir, stdio: 'pipe' })
    } catch (e) {
      skipExit = e.status
    }
    assert.equal(skipExit, 0, 'un commit que solo toca *.md debería saltar el build')

    // Commit 2: toca código de verdad — debe CONSTRUIR (exit 1), sea cual sea VERCEL_ENV.
    writeFileSync(join(dir, 'app.ts'), 'export const x = 2\n')
    git('add', '-A')
    git('commit', '--quiet', '-m', 'feat: cambia código')
    let buildExit = 0
    try {
      execFileSync('bash', ['-c', ignoreCommand], { cwd: dir, env: { ...process.env, VERCEL_ENV: 'production' } })
    } catch (e) {
      buildExit = e.status
    }
    assert.equal(buildExit, 1, 'un commit que toca código debe construir, incluso con VERCEL_ENV=production')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('los cron de Vercel son como máximo diarios y caben en Hobby', () => {
  const crons = JSON.parse(read('vercel.json')).crons
  assert.ok(crons.length <= 100)
  for (const { path, schedule } of crons) {
    const fields = schedule.trim().split(/\s+/)
    assert.equal(fields.length, 5, `${path} no usa cron Unix de cinco campos`)
    assert.doesNotMatch(fields[0], /\*|,|\/|-/, `${path} podría ejecutarse más de una vez por hora`)
    assert.doesNotMatch(fields[1], /\*|,|\/|-/, `${path} podría ejecutarse más de una vez al día`)
  }
})

test('los proveedores de IA terminan antes del presupuesto y no generan retry storms', () => {
  const provider = read('lib/ai/provider.ts')
  const claude = read('lib/ai/claude.ts')
  const gateway = read('lib/ai/agent/gateway.ts')
  assert.doesNotMatch(provider, /120_000/)
  for (const source of [provider, claude, gateway]) {
    assert.match(source, /maxRetries: 1/)
    assert.match(source, /timeout: 45_000/)
  }
})

test('el webhook de Stripe es rápido, firmado e idempotente sin trabajo externo', () => {
  const route = read('app/api/[tenant]/evergreen/webhooks/stripe/route.ts')
  assert.match(route, /export const maxDuration = 10/)
  assert.match(route, /verificarFirmaStripe/)
  assert.match(route, /error\.code === '23505'/)
  assert.doesNotMatch(route, /api\.stripe\.com/)

  const migration = read('supabase/migrations/20260915100000_tracking_sites_and_raw_layer.sql')
  assert.match(migration, /tenant_id.*source.*source_event_id/is)
})

test('solo los recursos seguros reciben caché compartida', () => {
  const accounts = read('app/api/[tenant]/evergreen/integraciones/cuentas-activas/route.ts')
  assert.match(accounts, /private, max-age=60/)
  assert.match(accounts, /Vary: 'Cookie'/)

  const fonts = read('app/api/[tenant]/evergreen/carruseles/fonts/route.ts')
  assert.match(fonts, /public, max-age=604800, s-maxage=604800/)

  const brief = read('app/api/[tenant]/evergreen/metricas/brief/route.ts')
  assert.doesNotMatch(brief, /s-maxage/)
})
