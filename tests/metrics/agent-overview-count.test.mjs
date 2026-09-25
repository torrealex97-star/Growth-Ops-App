import assert from 'node:assert/strict'
import test from 'node:test'
import { getBusinessOverview } from '../../lib/ai/agent/tools.ts'

// PostgREST HEAD devuelve count y data=null, también cuando sí hay contactos.
function client(contactCount) {
  return {
    from(table) {
      let head = false
      const query = {
        select(_columns, options) {
          head = options?.head === true
          return query
        },
        eq() {
          return query
        },
        gte() {
          return query
        },
        lte() {
          return query
        },
        limit() {
          return query
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: head ? null : [],
            count: table === 'contacts' ? contactCount : 0,
            error: null,
          }).then(resolve, reject)
        },
      }
      return query
    },
  }
}

for (const count of [12, 0, null]) {
  test(`Ask conserva el total HEAD de contactos: ${count}`, async () => {
    const result = await getBusinessOverview({ tenantId: 'tenant-test', sb: client(count) }, {})
    assert.equal(result.total_contactos, count)
  })
}
