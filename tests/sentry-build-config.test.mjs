import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

test('production config loads with Sentry enabled, using the build-only entry point', () => {
  const result = execFileSync(
    process.execPath,
    [
      '-e',
      "const c = require('./next.config.js'); if (typeof c.webpack !== 'function') throw new Error('Sentry webpack configuration missing'); console.log('configured')",
    ],
    {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        NEXT_PUBLIC_SENTRY_DSN: 'https://public@example.invalid/1',
        SENTRY_AUTH_TOKEN: '',
        VERCEL: '1',
      },
      encoding: 'utf8',
      timeout: 30000,
    }
  )
  assert.match(result, /configured/)
})
