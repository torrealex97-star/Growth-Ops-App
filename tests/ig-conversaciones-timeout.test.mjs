// TIME-OUT AL CARGAR CONVERSACIONES DE IG (21-sep).
// Causa raíz verificada en código: `fetchIgConversationsWithMessages` hacía 20 llamadas
// SERIALES a la Graph API (una por conversación para participants + mensajes): 0,5-2s cada
// una = 10-40s + las 3 de resolución previas, contra un presupuesto de 60s de la lambda.
// Aquí se fija el comportamiento nuevo: detalle EN PARALELO con pool acotado, la ruta
// responde configured:false con motivo en fallos de token/permisos, y el front acota su
// espera. El módulo cliente importa `crypto` y fetch de nodo: se replica la lógica del pool
// exacta y se verifica el fuente (patrón del repo: tests/youtube-oauth.test.mjs).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = dirname(aqui)
const lee = (p) => readFileSync(join(raiz, p), 'utf8')

// ——— Réplica EXACTA del pool de workers que vive en fetchIgConversationsWithMessages ———
async function poolReplica(pendientes, concurrencia) {
  const detalle = new Map()
  let cursor = 0
  async function worker() {
    while (cursor < pendientes.length) {
      const i = cursor++
      const d = await pendientes[i].tarea().catch(() => null)
      detalle.set(i, d ?? null)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, pendientes.length) }, worker))
  return detalle
}

test('el pool ejecuta en paralelo y acota la concurrencia', async () => {
  let enVuelo = 0
  let pico = 0
  const pendientes = Array.from({ length: 20 }, (_, i) => ({
    tarea: async () => {
      enVuelo++
      pico = Math.max(pico, enVuelo)
      await new Promise((r) => setTimeout(r, 15))
      enVuelo--
      return { i }
    },
  }))
  const t0 = Date.now()
  await poolReplica(pendientes, 5)
  const ms = Date.now() - t0
  assert.equal(pico, 5, 'nunca más de 5 en vuelo (rate limit de Meta)')
  // 20 tareas de 15ms en serie = 300ms; con pool de 5 ≈ 60ms. Margen holgado para el CI.
  assert.ok(ms < 200, `el pool paralelizó de verdad (${ms}ms; en serie habrían sido ~300ms)`)
})

test('el pool reparte TODAS las tareas aunque una falle', async () => {
  const hechas = []
  const pendientes = Array.from({ length: 7 }, (_, i) => ({
    tarea: async () => {
      if (i === 2) throw new Error('boom')
      hechas.push(i)
      return { i }
    },
  }))
  const detalle = await poolReplica(pendientes, 3)
  assert.equal(hechas.length, 6, 'las 6 sanas se ejecutan')
  assert.equal(detalle.get(2), null, 'la fallida queda en null, no tumba el resto')
})

test('el fuente del cliente usa pool acotado (no bucle serial) y degrada por conversación', () => {
  const src = lee('lib/instagram/client.ts')
  assert.match(src, /CONCURRENCIA_DETALLE = 5/, 'pool acotado declarado')
  assert.match(src, /Array\.from\(\{ length: Math\.min\(CONCURRENCIA_DETALLE/, 'workers = min(pool, conversaciones)')
  assert.match(src, /async function detalleDe/, 'detalle extraído a función que puede fallar sola')
  assert.match(src, /\.catch\(\(\) => null\)/, 'un fallo de detalle no tumba el listado')
  // El bucle serial viejo no debe quedar: for…of con await del detalle dentro.
  const cuerpo = src.slice(src.indexOf('fetchIgConversationsWithMessages'))
  assert.ok(!/for \(const c of rows[\s\S]*await graphGet\(/.test(cuerpo), 'ya no hay bucle serial con await')
})

test('la ruta responde configured:false con motivo en fallos de IG (no 500 ciego)', () => {
  const route = lee('app/api/[tenant]/evergreen/setting-ai/conversations/route.ts')
  assert.match(route, /e instanceof InstagramApiError/, 'distingue errores de la Graph API')
  assert.match(route, /motivo: motivoLegible\(e\.code, e\.message\)/, 'devuelve motivo legible')
  assert.match(route, /instagram_manage_messages/, 'nombra el permiso que falta')
  assert.match(route, /token_caducado/, 'cubre token caducado')
  assert.match(route, /limite_de_uso/, 'cubre rate limit')
  assert.match(route, /maxDuration = 30/, 'presupuesto honesto (no 60s de rueda)')
})

test('el front acota su espera y presenta el motivo', () => {
  const ui = lee('app/[tenant]/setting-ai/ConversacionesTab.tsx')
  assert.match(ui, /AbortController/, 'timeout en cliente')
  assert.match(ui, /35_000/, 'techo de espera razonable')
  assert.match(ui, /r\.ok \?/, 'revisa res.ok antes de parsear')
  assert.match(ui, /j\.motivo/, 'muestra el motivo accionable')
  assert.match(ui, /AbortError/, 'traduce el aborto a mensaje útil')
})
