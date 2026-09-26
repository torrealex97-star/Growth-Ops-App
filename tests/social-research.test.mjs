// Pruebas de la capa de investigación externa (lógica pura de lib/social/*).
// Sin imports de runtime: se verifica la semántica de los adapters y de la configuración
// replicando las funciones puras exactas (patrón del repo: módulos con fetch/Supabase no se
// importan desde tests .mjs, se replica la lógica y se congela).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const norm = read('lib/social/normalize.ts')
const apifySrc = read('lib/social/apify.ts')
const typesSrc = read('lib/social/types.ts')
const webhook = read('app/api/webhooks/apify/route.ts')
const research = read('app/api/[tenant]/evergreen/social/research/route.ts')
const migracion = read('supabase/migrations/20260919230000_social_research.sql')

// ------------------------------------------------------------------
// Replicación EXACTA de las utilidades puras de normalize.ts (congeladas aquí).
// ------------------------------------------------------------------
const num = (v) => {
  if (v == null) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const s = String(v).trim().replace(/\s/g, '')
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''))
  const n = Number(s.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : undefined
}
const str = (v) => (v == null || v === '' ? undefined : String(v))
function firstOf(o, keys) {
  for (const k of keys) {
    let v = o
    for (const part of k.split('.')) {
      if (v && typeof v === 'object') v = v[part]
      else {
        v = undefined
        break
      }
    }
    if (v != null && v !== '') return v
  }
  return undefined
}
function pushProfileOnce(profiles, seen, username, extra) {
  const clean = username.replace(/^@/, '').trim()
  if (!clean || seen.has(clean.toLowerCase())) return
  seen.add(clean.toLowerCase())
  profiles.push({ username: clean, ...extra })
}
const InstagramReelsAdapter = {
  normalize: (items, usernames) => {
    const posts = []
    const profiles = []
    const seen = new Set()
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const row = it
      const username = (str(firstOf(row, ['ownerUsername', 'username', 'owner'])) || usernames[0] || '').replace(
        /^@/,
        ''
      )
      const shortcode = str(firstOf(row, ['shortCode', 'shortcode', 'id']))
      if (!shortcode) continue
      posts.push({
        externalId: shortcode,
        username: username || undefined,
        contentType: str(firstOf(row, ['type', 'mediaType', 'productType'])) || 'reel',
        caption: str(firstOf(row, ['caption', 'text', 'description'])),
        postUrl:
          str(firstOf(row, ['url', 'postUrl'])) ||
          (username ? `https://www.instagram.com/reel/${shortcode}/` : undefined),
        mediaUrl: str(firstOf(row, ['videoUrl', 'mediaUrl', 'displayUrl'])),
        thumbnailUrl: str(firstOf(row, ['thumbnailUrl', 'displayUrl', 'coverUrl'])),
        publishedAt: str(firstOf(row, ['timestamp', 'publishedAt', 'takenAt'])) || undefined,
        viewsCount: num(firstOf(row, ['videoViewCount', 'viewCount', 'playCount', 'views'])),
        likesCount: num(firstOf(row, ['likesCount', 'likes', 'likeCount'])),
        commentsCount: num(firstOf(row, ['commentsCount', 'comments', 'commentCount'])),
        sharesCount: num(firstOf(row, ['videoShareCount', 'shareCount', 'shares'])),
        durationSeconds: num(firstOf(row, ['videoDuration', 'duration', 'durationSeconds'])),
        metadata: row,
      })
      pushProfileOnce(profiles, seen, username)
    }
    return { profiles, posts }
  },
}
const InstagramProfileAdapter = {
  normalize: (items) => {
    const profiles = []
    const posts = []
    for (const it of items) {
      if (!it || typeof it !== 'object') continue
      const row = it
      if (row.error && !row.username && !row.id) continue
      const inner = row.profile || row.user || row
      const username = str(firstOf(inner, ['username', 'handle', 'user', 'ownerUsername']))
      if (!username) continue
      const clean = username.replace(/^@/, '')
      profiles.push({
        username: clean,
        externalId: str(firstOf(inner, ['id', 'userId', 'profileId'])),
        displayName: str(firstOf(inner, ['fullName', 'name', 'displayName', 'title'])),
        biography: str(firstOf(inner, ['biography', 'bio', 'description'])),
        profileUrl: str(firstOf(inner, ['url', 'profileUrl'])) || `https://www.instagram.com/${clean}/`,
        avatarUrl: str(firstOf(inner, ['profilePicUrl', 'profilePicture', 'avatar', 'imageUrl'])),
        followersCount: num(firstOf(inner, ['followersCount', 'followers', 'followerCount'])),
        followingCount: num(firstOf(inner, ['followingCount', 'followsCount', 'following'])),
        postsCount: num(firstOf(inner, ['postsCount', 'mediaCount', 'posts'])),
        verified: Boolean(firstOf(inner, ['verified', 'isVerified'])) || undefined,
        metadata: inner,
      })
      const latest = inner.latestPosts || inner.posts || row.latestPosts || row.posts || []
      for (const p of latest) {
        const post = InstagramReelsAdapter.normalize([p], [clean]).posts[0]
        if (post) posts.push(post)
      }
    }
    return { profiles, posts }
  },
}

// ------------------------------------------------------------------
// §19 — multicanal y clasificación
// ------------------------------------------------------------------
test('la capa es multicanal desde el día 1: instagram, tiktok y youtube', () => {
  assert.ok(typesSrc.includes("'instagram', 'tiktok', 'youtube'"))
  assert.ok(migracion.includes("platform IN ('instagram', 'tiktok', 'youtube')"))
  assert.ok(typesSrc.includes('SOCIAL_JOB_TYPES'))
})

test('adapterFor resuelve un adapter por cada plataforma', () => {
  for (const p of ['instagram', 'tiktok', 'youtube']) {
    assert.ok(norm.includes(`platform === '${p}'`), `falta el caso ${p} en adapterFor`)
  }
})

// ------------------------------------------------------------------
// §6 — adapters: modelo interno ↔ esquema del Actor, sin asumir formato
// ------------------------------------------------------------------
test('el adapter de reels normaliza la salida típica de un Actor de Instagram', () => {
  const out = InstagramReelsAdapter.normalize(
    [
      {
        shortCode: 'CxAB12cd',
        ownerUsername: 'competidor',
        caption: 'Mi reel',
        videoViewCount: '12.345',
        likesCount: 999,
        commentsCount: 41,
        videoDuration: 31.2,
        timestamp: '2026-09-01T10:00:00Z',
      },
    ],
    ['competidor']
  )
  assert.equal(out.posts.length, 1)
  const p = out.posts[0]
  assert.equal(p.externalId, 'CxAB12cd')
  assert.equal(p.username, 'competidor')
  assert.equal(p.viewsCount, 12345) // string con separadores → número
  assert.equal(p.likesCount, 999)
  assert.equal(p.durationSeconds, 31.2)
  assert.equal(p.postUrl, 'https://www.instagram.com/reel/CxAB12cd/')
  assert.equal(out.profiles.length, 1)
  assert.equal(out.profiles[0].username, 'competidor')
})

test('el adapter no se rompe con claves alternativas (esquemas distintos de Actor)', () => {
  const out = InstagramReelsAdapter.normalize([{ id: 'zz9', username: '@otro', playCount: 5000, likeCount: 100 }], [])
  assert.equal(out.posts[0].externalId, 'zz9')
  assert.equal(out.posts[0].viewsCount, 5000)
  assert.equal(out.posts[0].username, 'otro')
})

test('filas sin id/shortcode se descartan sin tumbar el resto', () => {
  const out = InstagramReelsAdapter.normalize(
    [{ caption: 'sin id' }, { shortCode: 'ok1', ownerUsername: 'u1' }],
    ['u1']
  )
  assert.equal(out.posts.length, 1)
  assert.equal(out.posts[0].externalId, 'ok1')
})

test('el adapter de perfil soporta envoltorios y filtra filas de error', () => {
  const out = InstagramProfileAdapter.normalize([
    { error: true }, // fila de error sin datos: fuera
    { profile: { username: 'canal_a', followersCount: 4200, biography: 'bio' } },
    { user: { username: '@canal_b', followers: 7, latestPosts: [{ shortCode: 'p1', ownerUsername: 'canal_b' }] } },
  ])
  assert.equal(out.profiles.length, 2)
  assert.equal(out.profiles[0].followersCount, 4200)
  assert.equal(out.profiles[1].username, 'canal_b')
  assert.equal(out.posts.length, 1) // latestPosts del segundo
  assert.equal(out.posts[0].externalId, 'p1')
})

// ------------------------------------------------------------------
// §5/§25 — sin acoplarse a un Actor concreto + feature flag
// ------------------------------------------------------------------
test('el actorId viene SIEMPRE de configuración, nunca hardcodeado', () => {
  const sinComentarios = apifySrc.replace(/\/\/[^\n]*/g, '')
  assert.ok(!/apify\/instagram-reel-scraper/.test(sinComentarios), 'actor hardcodeado en código')
  assert.ok(apifySrc.includes('APIFY_INSTAGRAM_REELS_ACTOR_ID'))
  assert.ok(apifySrc.includes('APIFY_INSTAGRAM_PROFILE_ACTOR_ID'))
})

test('sin APIFY_API_TOKEN la capa queda desactivada (§25) y el catálogo pide el token', () => {
  assert.ok(apifySrc.includes('env.APIFY_API_TOKEN?.trim()') && apifySrc.includes('return null'))
  assert.ok(read('lib/integrations-catalog.ts').includes("required: ['APIFY_API_TOKEN']"))
})

// ------------------------------------------------------------------
// §17 — la cuenta propia jamás va al Actor; §1 — sin scraping propio
// ------------------------------------------------------------------
test('al Actor solo va input público: nunca tokens, cookies ni credenciales de la cuenta', () => {
  const sinComentarios = apifySrc.replace(/\/\/[^\n]*/g, '')
  assert.ok(
    !sinComentarios.includes('INSTAGRAM_ACCESS_TOKEN'),
    'credencial de la cuenta propia dentro de la capa Apify'
  )
  assert.ok(!/cookies|sessionid/i.test(sinComentarios.replace(/Jamás se envían credenciales/g, '')))
})

test('no hay scraping ni navegación automatizada contra Instagram en la infraestructura', () => {
  for (const [f, src] of Object.entries({
    'lib/social/apify.ts': apifySrc,
    'lib/social/normalize.ts': norm,
    'app/api/webhooks/apify/route.ts': webhook,
    'app/api/[tenant]/evergreen/social/research/route.ts': research,
  })) {
    assert.ok(
      !/puppeteer|selenium|playwright|sessionid|ds_user_id/i.test(src.replace(/\/\/[^\n]*/g, '')),
      `patrón prohibido en ${f}`
    )
  }
  // lib/instagram sigue siendo solo Graph API oficial
  const igClient = read('lib/instagram/client.ts').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  assert.ok(igClient.includes('graph.facebook.com'))
  assert.ok(!/puppeteer|selenium|playwright|sessionid/i.test(igClient))
})

// ------------------------------------------------------------------
// §7/§8 — asíncrono + webhook idempotente
// ------------------------------------------------------------------
test('el webhook valida run conocido, maneja los 4 estados finales y es idempotente', () => {
  assert.ok(webhook.includes('ACTOR.RUN.SUCCEEDED'))
  assert.ok(webhook.includes('run desconocido'))
  assert.ok(webhook.includes('provider_run_id'))
  assert.ok(webhook.includes('processRunResults'))
  assert.ok(apifySrc.includes("job.status === 'completed'"))
  for (const ev of ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED.OUT']) {
    assert.ok(webhook.includes(ev), `falta el estado ${ev}`)
  }
})

test('la ejecución es asíncrona: el POST responde enseguida y el resultado llega por webhook', () => {
  assert.ok(apifySrc.includes('/runs`'))
  assert.ok(!apifySrc.includes('waitForFinish'))
  assert.ok(webhook.includes('defaultDatasetId'))
})

// ------------------------------------------------------------------
// §24 — límites internos
// ------------------------------------------------------------------
test('topes internos: máx perfiles por run, resultados y concurrencia', () => {
  assert.ok(typesSrc.includes('maxProfilesPerRun: 10'))
  assert.ok(typesSrc.includes('maxResultsPerProfile: 100'))
  assert.ok(typesSrc.includes('maxConcurrentJobs: 2'))
  assert.ok(apifySrc.includes('maxConcurrentJobs'))
  assert.ok(apifySrc.includes('cfg.maxProfilesPerRun'))
})

// ------------------------------------------------------------------
// §4/§13 — token solo por header, cifrado, nunca al frontend
// ------------------------------------------------------------------
test('el token viaja por Authorization Bearer, nunca en la URL', () => {
  const sinComentarios = apifySrc.replace(/\/\/[^\n]*/g, '')
  assert.ok(sinComentarios.includes('Authorization'))
  assert.ok(!sinComentarios.includes('token='), 'token en query string')
})

test('APIFY_API_TOKEN está marcado como secreto en el catálogo (cifrado + enmascarado)', () => {
  const cat = read('lib/integrations-catalog.ts')
  const m = cat.match(/key: 'APIFY_API_TOKEN',[\s\S]{0,220}?secret: (true|false)/)
  assert.ok(m, 'campo no encontrado')
  assert.equal(m[1], 'true')
})

// ------------------------------------------------------------------
// §10 — modelo de datos
// ------------------------------------------------------------------
test('el modelo normalizado tiene unique y RLS solo-rol', () => {
  assert.ok(migracion.includes('UNIQUE (tenant_id, platform, username)'))
  assert.ok(migracion.includes('UNIQUE (tenant_id, platform, external_id)'))
  assert.ok(migracion.includes('ENABLE ROW LEVEL SECURITY'))
  assert.ok(migracion.includes('auth_tenant_ids()'))
  assert.ok(migracion.includes('social_raw_payloads')) // §11 raw aparte
})

// ------------------------------------------------------------------
// §16 — fuente visible y separación de UI
// ------------------------------------------------------------------
test('la UI de investigación declara la fuente y no mezcla la cuenta propia', () => {
  const ui = read('app/[tenant]/instagram/investigacion/page.tsx')
  assert.ok(ui.includes('SOURCE_LABEL.external'))
  assert.ok(ui.includes('proveedor externo'))
  assert.ok(!ui.includes('ig_media'), 'la pestaña de investigación no debe leer tablas de la cuenta propia')
})

test('la pestaña Investigación está en el layout sin tocar las pestañas oficiales', () => {
  const layout = read('app/[tenant]/instagram/layout.tsx')
  assert.ok(layout.includes('/instagram/investigacion'))
  assert.ok(layout.includes('/instagram/reels'))
  assert.ok(layout.includes('/instagram/competencia'))
})

// ------------------------------------------------------------------
// §8 — errores de persistencia, claim concurrente y reintento recuperable
// ------------------------------------------------------------------
test('Apify propaga errores de lectura/escritura y solo completa tras persistir todo', () => {
  const processSource = apifySrc.slice(apifySrc.indexOf('export async function processRunResults'))
  assert.match(processSource, /if \(jobError\) return \{ ok: false/)
  assert.match(processSource, /if \(upErr \|\| !up\) throw new Error/)
  assert.match(processSource, /if \(upErr\) throw new Error/)
  assert.match(processSource, /if \(rawReadError\) throw new Error/)
  assert.match(processSource, /if \(rawInsertError\) throw new Error/)
  assert.match(processSource, /if \(completionError \|\| !completedJob\) throw new Error/)
  assert.ok(processSource.indexOf('if (upErr) throw new Error') < processSource.indexOf("status: 'completed'"))
})

test('el claim CAS diferencia la ejecución del actor de la lease del webhook y habilita retry', () => {
  const processSource = apifySrc.slice(apifySrc.indexOf('export async function processRunResults'))
  assert.match(processSource, /const leaseMs = 5 \* 60 \* 1000/)
  assert.match(processSource, /APIFY_WEBHOOK_CLAIM_PREFIX/)
  assert.match(processSource, /previousError\?\.startsWith\(APIFY_WEBHOOK_CLAIM_PREFIX\)/)
  assert.match(processSource, /job\.status !== 'processing' && job\.status !== 'failed'/)
  assert.match(processSource, /\.eq\('status', job\.status\)/)
  assert.match(processSource, /\.eq\('started_at', previousStartedAt\)/)
  assert.match(processSource, /\.eq\('error_message', previousError\)/)
  assert.match(processSource, /if \(claimError \|\| !claimedJob\)/)
  assert.match(processSource, /\.eq\('started_at', processingStartedAt\)[\s\S]*?\.eq\('error_message', claimToken\)/)
  assert.match(processSource, /\.update\(\{ status: 'failed', error_message: msg/)
})

test('un webhook solicita retry si la lectura, escritura o procesamiento Apify falla', () => {
  assert.match(webhook, /if \(jobError\) return NextResponse\.json\([\s\S]*status: 500/)
  assert.match(webhook, /if \(datasetError\) return NextResponse\.json\([\s\S]*status: 500/)
  assert.match(webhook, /if \(!result\.ok\) return NextResponse\.json\(\{ error: result\.error \}, \{ status: 500 \}\)/)
})
