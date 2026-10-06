import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')
const canonicalOrigin = 'https://app.scalixsystems.com'
const retiredOrigin = 'https://growth-ops-weld.vercel.app'

test('runtime and auth configuration use the canonical production origin', () => {
  const runtimeConfig = [read('app/layout.tsx'), read('supabase/config.toml')].join('\n')

  assert.match(runtimeConfig, new RegExp(canonicalOrigin.replaceAll('.', '\\.')))
  assert.doesNotMatch(runtimeConfig, new RegExp(retiredOrigin.replaceAll('.', '\\.')))
})

test('scheduled workflows never fall back to the retired Vercel hostname', () => {
  const workflowDir = join(root, '.github', 'workflows')
  const scheduledWorkflows = readdirSync(workflowDir)
    .filter((name) => name.startsWith('cron-') || name === 'reparar-comisiones.yml')
    .map((name) => readFileSync(join(workflowDir, name), 'utf8'))
    .join('\n')

  assert.match(scheduledWorkflows, /vars\.CRON_APP_URL/)
  assert.match(scheduledWorkflows, new RegExp(canonicalOrigin.replaceAll('.', '\\.')))
  assert.doesNotMatch(scheduledWorkflows, new RegExp(retiredOrigin.replaceAll('.', '\\.')))
})

test('local project identifiers use the canonical technical name', () => {
  assert.equal(JSON.parse(read('package.json')).name, 'growth-ops-app')
  assert.match(read('supabase/config.toml'), /^project_id = "growth-ops-app"$/m)
})
