import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { DEFAULT_CONFIG } from '../lib/vsl/types.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')
const player = read('components/vsl/VslPlayer.tsx')
const dashboard = read('components/vsl/VslDashboard.tsx')

test('los vídeos nuevos priorizan poster-first y miniatura dinámica', () => {
  assert.equal(DEFAULT_CONFIG.autoplay, false)
  assert.equal(DEFAULT_CONFIG.thumbnailMode, 'animated')
  assert.equal(DEFAULT_CONFIG.showDurationOnPlay, true)
})

test('el motion poster usa el preview ligero de Bunny y conserva fallback estático', () => {
  assert.match(player, /derivadosDeSource\(src\)/)
  assert.match(player, /bunnyAssets\.preview/)
  assert.match(player, /poster &&/)
  assert.match(player, /motionPosterReady && motionPoster/)
})

test('ahorro de datos, reduced motion e intersección evitan descargar animación innecesaria', () => {
  assert.match(player, /connection\?\.saveData/)
  assert.match(player, /prefers-reduced-motion: reduce/)
  assert.match(player, /new IntersectionObserver/)
})

test('la portada ofrece play accesible, duración y texto opcional', () => {
  assert.match(player, /aria-label=\{`Reproducir/)
  assert.match(player, /cfg\.showDurationOnPlay/)
  assert.match(player, /cfg\.thumbnailText/)
  assert.match(player, /group-active:scale-\[0\.97\]/)
})

test('el formulario configura portada dinámica sin otra tabla ni migración', () => {
  assert.match(dashboard, /Miniatura dinámica/)
  assert.match(dashboard, /setCfg\('thumbnailMode'/)
  assert.match(dashboard, /setCfg\('thumbnailText'/)
  assert.match(dashboard, /setCfg\('showDurationOnPlay'/)
})
