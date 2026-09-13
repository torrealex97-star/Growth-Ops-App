import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isRetryableCode,
  lastRunsByJob,
  recordSyncRun,
  redactSecrets,
  SyncBusyError,
} from '../../lib/integrations/sync-runs.ts'

// Historial de ejecuciones. Existe porque el panel mandaba "revisa el último error del sync" y ese
// error no se guardaba en ninguna parte: una sync caída por credenciales dejaba la tabla vacía y el
// panel solo sabía decir "está vacía".

// ── Cliente Supabase de mentira, lo justo para observar lo que se escribe ────────────────────────
function fakeSb({ insertError = null } = {}) {
  const escrituras = { inserts: [], updates: [] }
  const client = {
    escrituras,
    from() {
      return {
        insert(row) {
          escrituras.inserts.push(row)
          return {
            select: () => ({
              single: async () =>
                insertError ? { data: null, error: insertError } : { data: { id: 'run-1' }, error: null },
            }),
          }
        },
        update(fields) {
          const chain = {
            _filters: {},
            eq(col, val) {
              chain._filters[col] = val
              return chain
            },
            lt() {
              return chain
            },
            then(res) {
              // `update(...).eq(...)` se espera directamente (sin .select()): se registra al await.
              escrituras.updates.push({ fields, filters: { ...chain._filters } })
              return Promise.resolve({ error: null }).then(res)
            },
          }
          return chain
        },
      }
    },
  }
  return client
}

test('una ejecución correcta queda como ok con las filas escritas', async () => {
  const sb = fakeSb()
  const res = await recordSyncRun(
    sb,
    { tenantId: 't1', provider: 'meta', job: 'meta', trigger: 'cron' },
    async () => ({ synced: 12, failures: [] }),
    (r) => ({ rowsWritten: r.synced, failures: r.failures })
  )
  assert.equal(res.synced, 12)
  assert.equal(sb.escrituras.inserts[0].status, 'running')
  assert.equal(sb.escrituras.inserts[0].tenant_id, 't1')
  const cierre = sb.escrituras.updates.at(-1)
  assert.equal(cierre.fields.status, 'ok')
  assert.equal(cierre.fields.rows_written, 12)
  assert.equal(cierre.fields.error_message, null)
})

test('los fallos parciales NO se guardan como éxito', async () => {
  // Antes se hacía `if (error) continue` y la sync devolvía ok con 0 filas: un fallo total era
  // indistinguible de una cuenta sin campañas.
  const sb = fakeSb()
  await recordSyncRun(
    sb,
    { tenantId: 't1', provider: 'meta', job: 'meta', trigger: 'manual' },
    async () => ({ synced: 0, failures: ['No se pudo guardar la campaña "X": null value in column tenant_id'] }),
    (r) => ({ rowsWritten: r.synced, failures: r.failures })
  )
  const cierre = sb.escrituras.updates.at(-1)
  assert.equal(cierre.fields.status, 'error')
  assert.match(cierre.fields.error_message, /No se pudo guardar la campaña/)
})

test('un error lanzado se guarda con su código y se vuelve a lanzar', async () => {
  const sb = fakeSb()
  const err = Object.assign(new Error('El token de Meta no es válido.'), { code: 'token_invalido' })
  await assert.rejects(
    () =>
      recordSyncRun(sb, { tenantId: 't1', provider: 'meta', job: 'meta', trigger: 'cron' }, async () => {
        throw err
      }),
    /no es válido/
  )
  const cierre = sb.escrituras.updates.at(-1)
  assert.equal(cierre.fields.status, 'error')
  assert.equal(cierre.fields.error_code, 'token_invalido')
})

test('si ya hay una ejecución en curso no se lanza otra', async () => {
  // El cerrojo es un índice único parcial en la base de datos: dos ejecuciones simultáneas duplican
  // filas y agotan el rate limit del proveedor.
  const sb = fakeSb({ insertError: { code: '23505', message: 'duplicate key' } })
  let corrio = false
  await assert.rejects(
    () =>
      recordSyncRun(sb, { tenantId: 't1', provider: 'meta', job: 'meta', trigger: 'cron' }, async () => {
        corrio = true
        return {}
      }),
    (e) => e instanceof SyncBusyError
  )
  assert.equal(corrio, false, 'no debe ejecutar el trabajo')
})

test('si el historial no se puede escribir, la sincronización se ejecuta igual', async () => {
  // La tabla puede no estar migrada todavía. Perder el historial es malo; no sincronizar es peor.
  const sb = fakeSb({ insertError: { code: '42P01', message: 'relation does not exist' } })
  const res = await recordSyncRun(sb, { tenantId: 't1', provider: 'meta', job: 'meta', trigger: 'cron' }, async () => ({
    ok: true,
  }))
  assert.deepEqual(res, { ok: true })
})

test('ninguna credencial acaba en el historial', async () => {
  const token = 'EAAG' + 'x'.repeat(60)
  const sb = fakeSb()
  await assert.rejects(() =>
    recordSyncRun(
      sb,
      { tenantId: 't1', provider: 'meta', job: 'meta', trigger: 'cron', secrets: [token, 'sk_live_abcdef123456'] },
      async () => {
        throw new Error(`falló https://graph.facebook.com/v25.0/me?access_token=${token} con sk_live_abcdef123456`)
      }
    )
  )
  const guardado = sb.escrituras.updates.at(-1).fields.error_message
  assert.ok(!guardado.includes(token), guardado)
  assert.ok(!guardado.includes('sk_live_abcdef123456'), guardado)
})

test('redactSecrets tapa tokens en URL, claves de Stripe y cabeceras Bearer', () => {
  assert.ok(!redactSecrets('?access_token=ABCDEF123456&x=1').includes('ABCDEF123456'))
  assert.ok(!redactSecrets('la clave sk_test_51Hxyz9876 falló').includes('sk_test_51Hxyz9876'))
  assert.ok(!redactSecrets('Authorization: Bearer abcdef1234567890').includes('abcdef1234567890'))
  // Un valor cortísimo no es una credencial: borrarlo destrozaría el mensaje.
  assert.equal(redactSecrets('error de red', ['ab']), 'error de red')
})

test('solo se reintenta lo que puede salir bien al repetirlo', () => {
  assert.equal(isRetryableCode('limite_de_uso'), true)
  assert.equal(isRetryableCode('red'), true)
  assert.equal(isRetryableCode('timeout'), true)
  assert.equal(isRetryableCode('token_invalido'), false)
  assert.equal(isRetryableCode('proof_invalido'), false)
  assert.equal(isRetryableCode(undefined), false)
})

test('lastRunsByJob se queda con la ejecución más reciente de cada sincronización', async () => {
  const filas = [
    {
      job: 'meta',
      provider: 'meta',
      status: 'error',
      trigger: 'cron',
      started_at: '2026-09-13T10:00:00Z',
      finished_at: null,
      rows_written: null,
      error_code: 'token_invalido',
      error_message: 'no vale',
    },
    {
      job: 'meta',
      provider: 'meta',
      status: 'ok',
      trigger: 'cron',
      started_at: '2026-09-12T10:00:00Z',
      finished_at: null,
      rows_written: 4,
      error_code: null,
      error_message: null,
    },
    {
      job: 'meta-daily',
      provider: 'meta',
      status: 'ok',
      trigger: 'cron',
      started_at: '2026-09-11T10:00:00Z',
      finished_at: null,
      rows_written: 9,
      error_code: null,
      error_message: null,
    },
  ]
  const sb = {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: async () => ({ data: filas, error: null }) }) }),
      }),
    }),
  }
  const runs = await lastRunsByJob(sb, 't1')
  assert.equal(runs.meta.status, 'error')
  assert.equal(runs.meta.errorCode, 'token_invalido')
  assert.equal(runs['meta-daily'].rowsWritten, 9)
})

test('si la tabla no existe, el panel se queda sin historial pero no se rompe', async () => {
  const sb = {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: 'no existe' } }) }) }),
      }),
    }),
  }
  assert.deepEqual(await lastRunsByJob(sb, 't1'), {})
})
