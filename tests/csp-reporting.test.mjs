import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { originSeguro, parsearInformesCsp } from '../lib/security/csp-report.ts'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

test('sanitiza URLs a origen y elimina path, query y fragmento', () => {
  assert.equal(originSeguro('https://cdn.example.com/private/user-42.js?token=secret#x'), 'https://cdn.example.com')
  assert.equal(originSeguro('javascript:alert(1)'), 'otro-esquema')
})

test('acepta el formato clásico sin conservar muestras ni URLs completas', () => {
  const reports = parsearInformesCsp({
    'csp-report': {
      'violated-directive': 'script-src-elem',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://third.example/script.js?email=person@example.com',
      'document-uri': 'https://app.scalixsystems.com/tenant/page?token=abc',
      'script-sample': 'private()',
      'status-code': 200,
    },
  })
  assert.deepEqual(reports, [
    {
      directive: 'script-src-elem',
      effectiveDirective: 'script-src-elem',
      blockedOrigin: 'https://third.example',
      documentOrigin: 'https://app.scalixsystems.com',
      disposition: 'unknown',
      statusCode: 200,
    },
  ])
  assert.doesNotMatch(JSON.stringify(reports), /person|private|token/)
})

test('acepta Reporting API, limita el lote y descarta entradas sin directiva', () => {
  const input = Array.from({ length: 25 }, (_, index) => ({
    type: 'csp-violation',
    body: index === 0 ? { blockedURL: 'https://invalid.example' } : { violatedDirective: 'connect-src' },
    url: 'https://app.scalixsystems.com/private/path',
  }))
  const reports = parsearInformesCsp(input)
  assert.equal(reports.length, 19)
  assert.equal(reports[0].directive, 'connect-src')
})

test('la cabecera es report-only y apunta al receptor público acotado', () => {
  const config = read('next.config.js')
  const middleware = read('middleware.ts')
  const route = read('app/api/security/csp-report/route.ts')
  assert.match(config, /Content-Security-Policy-Report-Only/)
  assert.match(config, /report-uri \/api\/security\/csp-report/)
  assert.match(middleware, /'\/api\/security\/csp-report'/)
  assert.match(route, /MAX_REPORT_BYTES = 32 \* 1024/)
  assert.match(route, /limitar\(`csp-report:/)
  assert.match(route, /12, 5 \* 60_000/)
  assert.doesNotMatch(route, /console\.warn\([^\n]*raw/)
})
