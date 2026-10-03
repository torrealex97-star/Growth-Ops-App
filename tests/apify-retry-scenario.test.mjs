// ESCENARIO APIFY CON FALLO Y REINTENTO — test de regresión de la unidad audit-integrity (PR #233).
//
// Ejercita processRunResults REAL (lib/social/apify.ts) contra:
//  - un mini-DB en memoria con las tablas que toca la capa (jobs con CAS real por comparación
//    de status/started_at/error_message, perfiles/posts con upsert idempotente por su unique,
//    raw con PK por job_id);
//  - global fetch INTERCEPTADO para servir el dataset de Apify — sin red ni credenciales.
//
// Congela el ciclo de vida que motivó el endurecimiento de #233: el webhook puede llegar antes
// de que la escritura del run sea visible (carrera READ COMMITTED), la lectura del dataset
// puede fallar (500 → Apify reintenta), un job failed es reintentable al instante y un reenvío
// duplicado del webhook no duplica datos. El claim CAS con lease de 5 min evita doble procesado.
import assert from 'node:assert/strict'
import test from 'node:test'

process.env.APIFY_API_TOKEN = process.env.APIFY_API_TOKEN || 'test-token-no-real'
const { processRunResults, ApifyService } = await import('../lib/social/apify.ts')

const RUN_ID = 'run-demo-0001'
const DATASET_ID = 'dataset_demo'
const TENANT = '00000000-0000-0000-0000-000000000000'
const cfg = { token: 'test-token-no-real', actors: {}, resultsLimit: 30, maxProfilesPerRun: 10 }

// ---------------------------------------------------------------------------
// Mini-DB en memoria con la semántica que la capa asume de Supabase.
// ---------------------------------------------------------------------------
function crearDb(filaJobInicial) {
  const job = { ...filaJobInicial }
  const perfiles = new Map() // tenant|platform|username → fila
  const posts = new Map() // tenant|platform|external_id → fila
  const raw = new Map() // job_id → fila
  const llamadas = { claimsFallidos: 0, rawInserts: 0 }
  let perfilSeq = 0

  function tabla(nombre) {
    let parche = null
    let upsert = null
    const comparaciones = []
    const coincide = () => comparaciones.every(({ col, val }) => String(job[col] ?? null) === String(val ?? null))

    const ejecutar = async () => {
      if (nombre === 'social_research_jobs') {
        if (!coincide()) {
          if (parche) llamadas.claimsFallidos++
          return { data: null, error: null }
        }
        if (parche) Object.assign(job, parche)
        return { data: parche ? { id: job.id } : { ...job }, error: null }
      }
      if (nombre === 'social_profiles') {
        const clave = `${upsert.tenant_id}|${upsert.platform}|${upsert.username}`
        const existente = perfiles.get(clave)
        if (!existente) {
          perfilSeq++
          perfiles.set(clave, { ...upsert, id: `perfil_demo_${perfilSeq}` })
          return { data: { id: `perfil_demo_${perfilSeq}`, username: upsert.username }, error: null }
        }
        Object.assign(existente, upsert)
        return { data: { id: existente.id, username: existente.username }, error: null }
      }
      if (nombre === 'social_posts') {
        const clave = `${upsert.tenant_id}|${upsert.platform}|${upsert.external_id}`
        posts.set(clave, { ...upsert }) // upsert idempotente: reescribe, no duplica
        return { data: null, error: null }
      }
      if (nombre === 'social_raw_payloads') {
        if (upsert) {
          if (raw.has(upsert.job_id)) return { data: null, error: null } // PK: el insert real fallaría
          raw.set(upsert.job_id, { ...upsert })
          llamadas.rawInserts++
        }
        return { data: null, error: null }
      }
      throw new Error(`tabla inesperada en el escenario: ${nombre}`)
    }

    const q = {
      select() {
        return q
      },
      insert(fila) {
        upsert = fila
        return q
      },
      update(f) {
        parche = f
        return q
      },
      upsert(f) {
        upsert = f
        return q
      },
      eq(col, val) {
        comparaciones.push({ col, val })
        return q
      },
      is(col, val) {
        comparaciones.push({ col, val })
        return q
      },
      in() {
        return q
      },
      limit() {
        return q
      },
      single: () => ejecutar(),
      maybeSingle: () => ejecutar(),
      then(onOk, onErr) {
        return ejecutar().then(onOk, onErr)
      },
    }
    return q
  }

  return {
    job,
    perfiles,
    posts,
    raw,
    llamadas,
    from(nombre) {
      return tabla(nombre)
    },
  }
}

// ---------------------------------------------------------------------------
// Fetch falso: dataset en dos páginas (offset 0 → página A, siguiente → página B).
// Modo normal: página A con 2 items (corta → el bucle para tras la primera petición).
// Modo paginado: página A LLENA (1000 items = limit) para forzar la segunda petición.
// ---------------------------------------------------------------------------
const PAGINA_A = [
  { shortCode: 'reel_aaa1', ownerUsername: 'competidor_demo', caption: 'uno', videoViewCount: '1.000', likesCount: 10 },
  { shortCode: 'reel_aaa2', ownerUsername: 'competidor_demo', caption: 'dos', videoViewCount: '2.000', likesCount: 20 },
]
const PAGINA_B = [
  {
    shortCode: 'reel_aaa3',
    ownerUsername: 'competidor_demo',
    caption: 'tres',
    videoViewCount: '3.000',
    likesCount: 30,
  },
]
const generarMil = () =>
  Array.from({ length: 1000 }, (_, i) => ({
    shortCode: `reel_${String(i).padStart(4, '0')}`,
    ownerUsername: 'competidor_demo',
    likesCount: i,
  }))
let datasetPeticiones = 0
let falloLectura = false
let paginado = false
const fetchReal = globalThis.fetch
function interceptarDataset(grande = false) {
  datasetPeticiones = 0
  falloLectura = false
  paginado = grande
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (!u.includes(`/datasets/${DATASET_ID}/items`)) {
      throw new Error(`fetch inesperado en el escenario: ${u}`)
    }
    datasetPeticiones++
    if (falloLectura) return { ok: false, status: 502, json: async () => ({}) }
    const offset = Number(u.match(/offset=(\d+)/)?.[1] || 0)
    const body = offset === 0 ? (paginado ? generarMil() : PAGINA_A) : PAGINA_B
    return { ok: true, status: 200, json: async () => body }
  }
}
function restaurarFetch() {
  globalThis.fetch = fetchReal
}

function filaNueva() {
  return {
    id: 'job-demo-0000-0000-0000-000000000000',
    tenant_id: TENANT,
    platform: 'instagram',
    provider: 'apify',
    job_type: 'reels',
    status: 'processing', // el run ya se asoció; el webhook llega enseguida (caso real 21-sep)
    provider_run_id: RUN_ID,
    provider_dataset_id: DATASET_ID,
    started_at: new Date().toISOString(),
    error_message: null,
    input_json: { usernames: ['competidor_demo'], resultsLimit: 30, jobType: 'reels' },
    records_processed: null,
  }
}

test('ciclo completo: run invisible → dataset 502 → reintento completa → duplicado idempotente', async (t) => {
  t.after(restaurarFetch)
  interceptarDataset()

  // ── 1. Webhook 1: el run aún no es visible (provider_run_id sin escribir, carrera
  //       READ COMMITTED) → fallo controlado, sin leer dataset ni tocar el job.
  const db1 = crearDb({ ...filaNueva(), provider_run_id: null })
  const r1 = await processRunResults(db1, cfg, RUN_ID)
  assert.equal(r1.ok, false, 'sin run visible el intento debe fallar')
  assert.match(r1.error, /run desconocido/)
  assert.equal(datasetPeticiones, 0, 'sin run no se lee ningún dataset')
  assert.equal(db1.job.status, 'processing', 'el fallo de consulta no toca el job')

  // ── 2. Webhook 2 (reintento de Apify tras el 500): run visible, reclama con CAS y la lectura
  //       del dataset FALLA → job failed con el error real, NUNCA completed.
  const db2 = crearDb(filaNueva())
  falloLectura = true
  const r2 = await processRunResults(db2, cfg, RUN_ID)
  assert.equal(r2.ok, false, 'la lectura del dataset rota debe fallar')
  assert.equal(db2.job.status, 'failed', 'el job queda failed, nunca completed con dataset fallido')
  assert.match(db2.job.error_message, /Apify respondió 502/)
  assert.equal(datasetPeticiones, 1)

  // ── 3. Webhook 3 (reintento de Apify): failed es reintentable al instante — el claim CAS
  //       encaja (status/started_at/error_message sin cambios) y TODO funciona.
  falloLectura = false
  const r3 = await processRunResults(db2, cfg, RUN_ID)
  assert.equal(r3.ok, true, `el reintento debe completar: ${r3.error || ''}`)
  assert.equal(r3.records, 2, 'los dos posts de la página del dataset quedan procesados')
  assert.equal(db2.job.status, 'completed')
  assert.equal(db2.job.error_message, null, 'el token de claim se limpia al completar')
  assert.equal(db2.job.records_processed, 2)
  assert.equal(db2.perfiles.size, 1, 'un perfil en el dataset')
  assert.equal(db2.posts.size, 2, 'dos posts, ninguno duplicado')
  assert.equal(db2.raw.size, 1, 'el payload raw se guarda una vez')
  assert.equal(db2.llamadas.rawInserts, 1)
  assert.equal(datasetPeticiones, 2, 'una petición fallida (r2) + una del reintento: página corta corta el bucle')

  // ── 4. Reenvío duplicado del webhook (idempotencia de entrega): completed → ok sin retrabajo.
  const r4 = await processRunResults(db2, cfg, RUN_ID)
  assert.equal(r4.ok, true)
  assert.equal(r4.records, 0, 'el reenvío no re-procesa registros')
  assert.equal(db2.posts.size, 2, 'sin posts nuevos')
  assert.equal(db2.raw.size, 1, 'sin raw duplicado')
  assert.equal(datasetPeticiones, 2, 'un job completado no vuelve a leer el dataset')
})

test('lease activa protege el procesado; expirada permite el relevo y la carrera deja un solo ganador', async (t) => {
  t.after(restaurarFetch)
  interceptarDataset()

  // ── A. Lease VIVA: processing + claim reciente → rechazo inmediato, cero lecturas.
  const leaseViva = filaNueva()
  leaseViva.error_message = 'apify_webhook_claim:token-activo'
  const dbA = crearDb(leaseViva)
  const rA = await processRunResults(dbA, cfg, RUN_ID)
  assert.equal(rA.ok, false)
  assert.match(rA.error, /reintenta/)
  assert.equal(datasetPeticiones, 0, 'la lease viva no llega a leer dataset')

  // ── B. Lease EXPIRADA (> 5 min): el webhook repetido toma el relevo y completa.
  const leaseVieja = filaNueva()
  leaseVieja.started_at = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  leaseVieja.error_message = 'apify_webhook_claim:token-muerto'
  const dbB = crearDb(leaseVieja)
  const rB = await processRunResults(dbB, cfg, RUN_ID)
  assert.equal(rB.ok, true, `la lease expirada debe permitir procesar: ${rB.error || ''}`)
  assert.equal(dbB.job.status, 'completed')
  assert.equal(dbB.posts.size, 2)

  // ── C. Dos webhooks a la vez sobre el mismo job: uno solo procesa.
  //       En un único proceso ambos leen el job antes de que ninguno reclame: al perdedor lo
  //       rechaza el CAS (claimFallidos) o la lease del ganador según el interleaving; en
  //       producción, con transacciones READ COMMITTED independientes, el CAS es la garantía.
  const dbC = crearDb(filaNueva())
  const [ganador, perdedor] = await Promise.all([
    processRunResults(dbC, cfg, RUN_ID),
    processRunResults(dbC, cfg, RUN_ID),
  ])
  const exitosos = [ganador, perdedor].filter((r) => r.ok)
  assert.equal(exitosos.length, 1, 'solo un webhook procesa el job a la vez')
  assert.match((exitosos[0] === ganador ? perdedor : ganador).error, /reclamado|reintenta/)
  assert.equal(dbC.posts.size, 2, 'los posts se escriben una sola vez')
})

test('estado terminal del proveedor marca el job sin leer dataset y fetchDatasetItems pagina sola', async (t) => {
  t.after(restaurarFetch)
  interceptarDataset(true) // primera página LLENA (1000 = limit) para forzar la segunda petición

  const db = crearDb(filaNueva())
  const r = await processRunResults(db, cfg, RUN_ID, { finalStatus: 'failed', errorMessage: 'Actor falló' })
  assert.equal(r.ok, true)
  assert.equal(db.job.status, 'failed')
  assert.equal(db.job.error_message, 'Actor falló')
  assert.equal(datasetPeticiones, 0, 'los finales del proveedor no tocan el dataset')

  // 1000 (página llena, sigue) + 1 (página corta, para) = 1001 items en dos peticiones.
  const items = await ApifyService.fetchDatasetItems(DATASET_ID, cfg.token, 1003)
  assert.equal(items.length, 1001)
  assert.equal(items[0].shortCode, 'reel_0000')
  assert.equal(items[1000].shortCode, 'reel_aaa3')
  assert.equal(datasetPeticiones, 2, 'paginación §9: dos peticiones (offset 0 y offset 1000)')
})
