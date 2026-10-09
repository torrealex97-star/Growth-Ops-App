import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// PARIDAD VSL II — velocidad de carga, customización, thumbnails dinámicos y métricas conectadas
// (lo que el usuario marca como lo más importante de Wistia/PandaVideo/Vidalytics; segunda pasada
// tras #241). El resumen agregado conecta los KPIs de VSL con el dashboard; los artefactos de
// Bunny (thumbnail/preview/storyboard) se derivan de la URL de origen SIN migración.

import { derivadosDeSource } from '../lib/vsl/types.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const limpiar = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const player = limpiar(read('components/vsl/VslPlayer.tsx'))
const types = limpiar(read('lib/vsl/types.ts'))
const resumen = limpiar(read('app/api/[tenant]/evergreen/vsl/resumen/route.ts'))
const dash = limpiar(read('components/vsl/VslDashboard.tsx'))

const BUNNY = 'https://vsl-bunny.b-cdn.net/3f2a1b8c-0000-1111-2222-333344445555/playlist.m3u8'
const NO_BUNNY = 'https://cdn.example.com/videos/mivsl.m3u8'

test('derivadosDeSource: Bunny genera thumbnail, preview animado y storyboard; otro origen no', () => {
  const d = derivadosDeSource(BUNNY)
  assert.equal(d.playlist, BUNNY)
  assert.equal(d.thumbnail, 'https://vsl-bunny.b-cdn.net/3f2a1b8c-0000-1111-2222-333344445555/thumbnail.jpg')
  assert.equal(d.preview, 'https://vsl-bunny.b-cdn.net/3f2a1b8c-0000-1111-2222-333344445555/preview.webp')
  assert.equal(d.storyboard, 'https://vsl-bunny.b-cdn.net/3f2a1b8c-0000-1111-2222-333344445555/storyboard.vtt')

  const f = derivadosDeSource(NO_BUNNY)
  assert.deepEqual(f, { playlist: null, thumbnail: null, preview: null, storyboard: null })
  assert.deepEqual(derivadosDeSource(null), { playlist: null, thumbnail: null, preview: null, storyboard: null })
})

test('velocidad de carga: HLS arranca por la calidad más baja y preload se adapta al autoplay', () => {
  assert.ok(player.includes('startLevel: 0'), 'fast-start: primer fragmento de menor calidad')
  assert.ok(player.includes('abrEwmaDefaultEstimate'), 'ABR conservador al arrancar')
  assert.ok(player.includes("cfg.autoplay ? 'auto' : 'metadata'"), 'preload selectivo')
})

test('customización del reproductor: botón central y fullscreen son configurables', () => {
  assert.ok(player.includes('cfg.showCentralPlay !== false'), 'botón central desactivable')
  assert.ok(player.includes('cfg.showFullscreenBtn !== false'), 'fullscreen desactivable')
  assert.ok(types.includes('showCentralPlay: true'), 'por defecto visibles (no cambia vídeos existentes)')
  assert.ok(types.includes('showFullscreenBtn: true'))
})

test('thumbnails dinámicos: las tarjetas muestran miniatura y preview animado al hover', () => {
  assert.ok(dash.includes('derivadosDeSource'), 'el dashboard deriva los artefactos de Bunny')
  assert.ok(dash.includes('derived.thumbnail') && dash.includes('derived.preview'), 'miniatura + preview en la tarjeta')
  assert.ok(dash.includes('previewSlug === video.slug'), 'el preview solo se carga en hover')
  assert.ok(dash.includes('loading="lazy"'), 'las miniaturas no compiten con el contenido inicial')
})

test('métricas conectadas: el resumen agregado existe, exige pantalla y usa los mismos criterios', () => {
  assert.ok(resumen.includes('requirePantalla'), 'autorización por pantalla, no por sesión suelta')
  assert.ok(resumen.includes('tenant_id = ${tenantId}'), 'filtro de tenant en TODAS las subconsultas')
  assert.ok(resumen.includes('max_position > 0'), 'play = reproducción real, mismo criterio que métricas')
  assert.ok(dash.includes('/vsl/resumen') && dash.includes('setResumen'), 'el dashboard lo consume')
  assert.ok(dash.includes('Play rate'), 'los KPIs agregados se pintan')
})
