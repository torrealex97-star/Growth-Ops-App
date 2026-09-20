// Prototipo de la capa ORGÁNICA (20-sep): adapter TikTok con perfiles (recentVideos[]) y
// agregación semántica agregarOrganico(). Los módulos son TS puro → import directo (mismo
// patrón que tests/control-pagos-personas.test.mjs).
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const NORMALIZE = join(aqui, '..', 'lib', 'social', 'normalize.ts')
const ORGANIC = join(aqui, '..', 'lib', 'social', 'organic.ts')
if (!existsSync(NORMALIZE) || !existsSync(ORGANIC)) {
  console.log('skip: módulos no presentes en este checkout (se ejecuta desde el repo)')
  process.exit(0)
}

const { TikTokAdapter } = await import(NORMALIZE)
const { agregarOrganico } = await import(ORGANIC)

test('TikTok adapter: item de PERFIL con recentVideos[] (clockworks/tiktok-profile-scraper) → perfil + vídeos aplanados', () => {
  const { profiles, posts } = TikTokAdapter.normalize(
    [
      {
        id: 'user-1',
        uniqueId: 'negocio',
        nickname: 'Negocio Oficial',
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
            webVideoUrl: 'https://www.tiktok.com/@negocio/video/v1',
          },
          {
            id: 'v2',
            text: 'segundo',
            playCount: 8000,
            diggCount: 400,
            commentCount: 20,
            createTimeISO: '2026-08-01T10:00:00.000Z',
          },
        ],
      },
    ],
    ['negocio']
  )
  assert.equal(profiles.length, 1)
  assert.equal(profiles[0].username, 'negocio')
  assert.equal(profiles[0].followersCount, 12000)
  assert.equal(profiles[0].postsCount, 240)
  assert.equal(posts.length, 2)
  assert.equal(posts[0].externalId, 'v1')
  assert.equal(posts[0].viewsCount, 50000)
  assert.equal(posts[0].likesCount, 3200)
  assert.match(posts[0].postUrl || '', /tiktok\.com\/@negocio\/video\/v1/)
})

test('TikTok adapter: filas planas de vídeo siguen normalizando (Actors de scraping por vídeo)', () => {
  const { profiles, posts } = TikTokAdapter.normalize(
    [
      {
        id: 'v9',
        author: { uniqueId: 'otro' },
        text: 'vídeo plano',
        playCount: 1000,
        diggCount: 50,
        commentCount: 5,
        shareCount: 2,
      },
    ],
    ['otro']
  )
  assert.equal(posts.length, 1)
  assert.equal(posts[0].username, 'otro')
  assert.equal(posts[0].viewsCount, 1000)
  assert.equal(profiles.length, 1)
})

const perfiles = [
  {
    platform: 'instagram',
    username: 'negocio',
    followers_count: 90000,
    posts_count: 800,
    collected_at: '2026-09-19T00:00:00Z',
  },
  {
    platform: 'tiktok',
    username: 'negocio',
    followers_count: 12000,
    posts_count: 240,
    collected_at: '2026-09-19T00:00:00Z',
  },
  // Snapshot ANTIGUO de instagram: no debe ganarle al más reciente.
  {
    platform: 'instagram',
    username: 'viejo',
    followers_count: 88000,
    posts_count: 790,
    collected_at: '2026-09-01T00:00:00Z',
  },
]

const posts = [
  // Instagram: dentro del periodo.
  {
    platform: 'instagram',
    published_at: '2026-09-10T10:00:00Z',
    likes_count: 1500,
    comments_count: 90,
    post_url: 'https://instagram.com/p/a',
  },
  // Instagram: fuera del periodo (no cuenta).
  { platform: 'instagram', published_at: '2026-07-01T10:00:00Z', likes_count: 9000, comments_count: 500 },
  // TikTok: dentro, con views.
  {
    platform: 'tiktok',
    published_at: '2026-09-12T10:00:00Z',
    views_count: 50000,
    likes_count: 3200,
    comments_count: 180,
    shares_count: 90,
    post_url: 'https://tiktok.com/@negocio/video/v1',
  },
  {
    platform: 'tiktok',
    published_at: '2026-09-13T10:00:00Z',
    views_count: 30000,
    likes_count: 2100,
    comments_count: 60,
    shares_count: 30,
    post_url: 'https://tiktok.com/@negocio/video/v2',
  },
  // YouTube: sin perfil → no aparece (no se inventan plataformas).
  { platform: 'youtube', published_at: '2026-09-12T10:00:00Z', views_count: 999 },
]

const rango = { desde: '2026-08-20T00:00:00Z', hasta: '2026-09-20T00:00:00Z' }
const resumen = agregarOrganico(perfiles, posts, rango)
const ig = resumen.find((p) => p.platform === 'instagram')
const tt = resumen.find((p) => p.platform === 'tiktok')

test('agregarOrganico: solo plataformas con perfil snapshot, el snapshot más reciente gana', () => {
  assert.deepEqual(resumen.map((p) => p.platform).sort(), ['instagram', 'tiktok'])
  assert.equal(ig.handle, 'negocio')
  assert.equal(ig.followers, 90000)
})

test('agregarOrganico: periodo filtra posts, sin convertir "no atribuible" en cero operacional', () => {
  assert.equal(ig.postsPeriodo, 1)
  assert.equal(ig.likesPeriodo, 1500)
  assert.equal(tt.postsPeriodo, 2)
  assert.equal(tt.viewsPeriodo, 80000)
  assert.equal(tt.sharesPeriodo, 120)
})

test('agregarOrganico: engagement con fórmula visible según lo que el dato público da', () => {
  // TikTok: hay views → (likes+comments)/views.
  assert.equal(tt.engagementFormula, 'likes+comments / views')
  assert.equal(tt.engagementRate.toFixed(4), (5540 / 80000).toFixed(4))
  // Instagram público no da impresiones → sobre seguidores, fórmula declarada en la UI.
  assert.equal(ig.engagementFormula, 'likes+comments / followers')
  assert.equal(ig.engagementRate.toFixed(5), (1590 / 90000).toFixed(5))
})

test('agregarOrganico: top contenidos por views dentro del periodo', () => {
  assert.equal(tt.topContenidos.length, 2)
  assert.equal(tt.topContenidos[0].views, 50000)
  assert.equal(ig.topContenidos[0].likes, 1500)
})

test('agregarOrganico: sin filas no se inventan métricas', () => {
  assert.deepEqual(agregarOrganico([], []), [])
})
