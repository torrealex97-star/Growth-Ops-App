// CAPA ORGÁNICA (21-sep): métricas de las cuentas PROPIAS por APIs OFICIALES (ig_media /
// ig_account_daily, poblados por lib/instagram/sync.ts con Graph API). Apify JAMÁS scrapea
// cuentas propias: los tests del guard lo fijan. Los módulos puros se importan directo
// (mismo patrón que tests/control-pagos-personas.test.mjs); los guards se verifican sobre
// el fuente de las rutas (mismo patrón que tests/social-research.test.mjs).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const NORMALIZE = join(aqui, '..', 'lib', 'social', 'normalize.ts')
const ORGANIC = join(aqui, '..', 'lib', 'social', 'organic.ts')
const ROUTE_ORGANIC = join(aqui, '..', 'app', 'api', '[tenant]', 'evergreen', 'organic', 'route.ts')
const ROUTE_RESEARCH = join(aqui, '..', 'app', 'api', '[tenant]', 'evergreen', 'social', 'research', 'route.ts')
if (!existsSync(NORMALIZE) || !existsSync(ORGANIC)) {
  console.log('skip: módulos no presentes en este checkout (se ejecuta desde el repo)')
  process.exit(0)
}

const { TikTokAdapter } = await import(NORMALIZE)
const { agregarOrganicoOficial } = await import(ORGANIC)
const read = (p) => readFileSync(p, 'utf8')

// ─── Adapter TikTok (terceros — sigue siendo Apify, eso sí es su sitio) ──────────────

test('TikTok adapter: item de PERFIL con recentVideos[] (clockworks/tiktok-profile-scraper) → perfil + vídeos aplanados', () => {
  const { profiles, posts } = TikTokAdapter.normalize(
    [
      {
        id: 'user-1',
        uniqueId: 'competidor',
        nickname: 'Competidor Oficial',
        followers: 12000,
        following: 300,
        videoCount: 240,
        verified: false,
        bioDescription: 'bio',
        recentVideos: [
          {
            id: 'v1',
            text: 'primer vídeo',
            playCount: 50000,
            diggCount: 3200,
            commentCount: 180,
            shareCount: 90,
            createTimeISO: '2026-09-10T10:00:00.000Z',
            webVideoUrl: 'https://www.tiktok.com/@competidor/video/v1',
          },
        ],
      },
    ],
    ['competidor']
  )
  assert.equal(profiles.length, 1)
  assert.equal(profiles[0].username, 'competidor')
  assert.equal(profiles[0].followersCount, 12000)
  assert.equal(posts.length, 1)
  assert.equal(posts[0].viewsCount, 50000)
})

// ─── Métricas OFICIALES de la cuenta propia (agregarOrganicoOficial) ────────────────

const perfil = { platform: 'instagram', followers_count: 2512, posts_count: 185, collected_at: '2026-09-21T10:00:00Z' }
const medias = [
  // Dentro del periodo, con métricas oficiales completas.
  {
    media_type: 'VIDEO',
    published_at: '2026-09-10T10:00:00Z',
    likes: 150,
    comments: 20,
    views: 5000,
    reach: 4200,
    shares: 30,
    saved: 45,
    engagement_rate: 4.6,
    permalink: 'https://instagram.com/p/a',
    synced_at: '2026-09-21T10:00:00Z',
  },
  {
    media_type: 'IMAGE',
    published_at: '2026-09-12T10:00:00Z',
    likes: 80,
    comments: 10,
    views: null,
    reach: 1500,
    shares: null,
    saved: 12,
    engagement_rate: null,
    permalink: 'https://instagram.com/p/b',
    synced_at: '2026-09-21T10:00:00Z',
  },
  // Fuera del periodo: no cuenta.
  {
    published_at: '2026-07-01T10:00:00Z',
    likes: 9999,
    comments: 999,
    views: 99999,
    reach: 99999,
    synced_at: '2026-09-21T10:00:00Z',
  },
]
const snapshots = [
  {
    snapshot_date: '2026-09-20',
    followers_count: 2512,
    reach: 12000,
    profile_views: 800,
    new_follows: 40,
    unfollows: 9,
  },
  {
    snapshot_date: '2026-09-19',
    followers_count: 2500,
    reach: 11000,
    profile_views: 700,
    new_follows: 22,
    unfollows: 4,
  },
]

const rango = { desde: '2026-08-20T00:00:00Z', hasta: '2026-09-21T23:59:59Z' }
const r = agregarOrganicoOficial(perfil, medias, snapshots, rango)

test('métricas oficiales: periodo filta, suma solo lo del periodo y usa datos de Graph API', () => {
  assert.equal(r.platform, 'instagram')
  assert.equal(r.postsPeriodo, 2)
  assert.equal(r.likesPeriodo, 230)
  assert.equal(r.commentsPeriodo, 30)
  assert.equal(r.sharesPeriodo, 30)
  assert.equal(r.savedPeriodo, 57)
  assert.equal(r.viewsPeriodo, 5000)
  // El alcance del periodo es el de CUENTA del snapshot diario (el por-media se solapa).
  assert.equal(r.reachPeriodo, 12000)
  assert.equal(r.followers, 2512)
})

test('métricas oficiales: engagement sobre REACH oficial, fórmula declarada', () => {
  assert.equal(r.engagementFormula, 'interacciones / reach (Graph API)')
  // (230 likes + 30 comments + 30 shares + 57 saved) / 12000 = 347/12000
  assert.equal(r.engagementRate.toFixed(6), (347 / 12000).toFixed(6))
})

test('métricas oficiales: top contenidos por views dentro del periodo', () => {
  assert.equal(r.topContenidos.length, 2)
  assert.equal(r.topContenidos[0].views, 5000)
  assert.equal(r.topContenidos[0].likes, 150)
})

test('métricas oficiales: sin datos no se inventan ceros ni perfiles fantasma', () => {
  assert.equal(agregarOrganicoOficial(null, medias, snapshots, rango), null)
  const vacio = agregarOrganicoOficial(perfil, [], snapshots, rango)
  assert.equal(vacio.postsPeriodo, 0)
  assert.equal(vacio.likesPeriodo, 0)
  assert.equal(vacio.engagementRate, undefined) // sin posts del periodo no se divide nada
  assert.equal(vacio.viewsPeriodo, undefined)
})

// ─── GUARDS: Apify nunca para cuentas propias ────────────────────────────────────────

test('GUARD organic: el POST rechaza payloads con handles y deriva SIEMPRE a la sync oficial', () => {
  const src = read(ROUTE_ORGANIC)
  assert.ok(
    src.includes('propietario_no_va_por_apify'),
    'el POST organic debe rechazar handles con código propietario_no_va_por_apify'
  )
  assert.ok(
    src.includes('evergreen/instagram/sync'),
    'el POST organic debe derivar a la sync oficial de Instagram (Graph API)'
  )
  // El GET solo lee tablas oficiales: cero imports del cliente de Apify para datos.
  assert.ok(
    src.includes(".from('ig_media')") && src.includes(".from('ig_account_daily')"),
    'el GET organic lee de ig_media/ig_account_daily'
  )
  assert.ok(!/createResearchJob/.test(src), 'el route organic NO debe lanzar jobs de Apify')
})

test('GUARD research: Apify rechaza explícitamente los handles PROPIOS del tenant', () => {
  const src = read(ROUTE_RESEARCH)
  assert.ok(
    src.includes('cuenta_propia_no_va_por_apify'),
    'la ruta de investigación debe rechazar handles propios con código cuenta_propia_no_va_por_apify'
  )
  // El guard compara contra los handles declarados en Integraciones (sin @, insensible a mayúsculas).
  assert.ok(src.includes('IG_HANDLE') && src.includes('TIKTOK_HANDLE') && src.includes('YOUTUBE_HANDLE'))
  assert.ok(src.includes('toLowerCase()'), 'la comparación de handles debe ser insensible a mayúsculas')
})

test('organic GET declara la fuente official y el uso de Apify como solo-terceros', () => {
  const src = read(ROUTE_ORGANIC)
  assert.ok(src.includes("source: 'official'"))
  assert.ok(src.includes('solo investigación de terceros'))
})
