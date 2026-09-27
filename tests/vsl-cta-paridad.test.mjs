import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// PARIDAD VSL — CTA programado (Vidalytics) e hitos de visión (Vidalytics/Wistia).
//
// El reproductor ya cubría autoplay con fallback, lockSeek, barra acelerada, gancho de salida y
// prueba social. Faltaban los dos diferenciales del informe FASE A / WISHLIST 4: el CTA que
// aparece en un % del vídeo (con auto-pausa opcional, el clásico de Vidalytics) y los hitos de
// retención por tramos en métricas. Ambos derivados de lo existente: config JSONB (sin migración)
// y max_position de vsl_sessions.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const limpiar = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const player = limpiar(read('components/vsl/VslPlayer.tsx'))
const types = limpiar(read('lib/vsl/types.ts'))
const metrics = limpiar(read('app/api/[tenant]/evergreen/vsl/metrics/[slug]/route.ts'))
const dash = limpiar(read('components/vsl/VslDashboard.tsx'))

test('el CTA se dispara una vez al cruzar el % configurado y puede pausar el vídeo', () => {
  assert.ok(player.includes('cfg.ctaEnabled &&'), 'el disparo comprueba ctaEnabled')
  assert.ok(player.includes('ctaShownRef.current = true'), 'se marca como mostrado')
  // Sin sensibilidad al formateo: se compara sin espacios (prettier reordena paréntesis/espacios).
  const plano = player.replace(/\s+/g, '')
  assert.ok(
    plano.includes('(el.currentTime/d)*100>=Math.min(100,Math.max(0,cfg.ctaAtPercent))'),
    'el disparo compara el % visto con ctaAtPercent acotado'
  )
  assert.ok(player.includes('if (cfg.ctaPause) el.pause()'), 'auto-pausa opcional')
})

test('el CTA no se dispara sin URL y se cierra/reenablea según ctaOnce', () => {
  assert.ok(player.includes('cfg.ctaUrl &&'), 'sin URL no se dispara')
  const idxOnce = player.indexOf('cfg.ctaOnce')
  assert.ok(idxOnce > -1, 'ctaOnce existe')
  // El cierre marca dismissed y reanuda el vídeo si estaba pausado por el CTA.
  assert.ok(player.includes('ctaDismissedRef.current = true'))
  assert.ok(player.includes('el.play().catch(() => {})'))
})

test('el render del CTA es accesible y sanea la URL antes de enlazar', () => {
  assert.ok(player.includes('role="dialog"'), 'role dialog')
  assert.ok(player.includes('aria-label="Llamada a la acción"'))
  // URL relativa o http(s); otra cosa se antepone https:// (evita javascript: y esquemas raros).
  assert.ok(player.includes("cfg.ctaUrl.startsWith('/') || /^https?:"), 'saneo de esquema antes de href')
  assert.ok(player.includes('target="_blank"') && player.includes('rel="noopener noreferrer"'))
  assert.ok(player.includes("sendBeat('cta')"), 'el click del CTA se marca en el latido')
})

test('los hitos de visión se calculan desde max_position y cubren 25/50/75/95/100', () => {
  for (const p of [0.25, 0.5, 0.75, 0.95]) {
    assert.ok(metrics.includes(`duration * ${p}`), `falta el hito ${p * 100}%`)
  }
  assert.ok(metrics.includes('milestones'), 'la respuesta incluye milestones')
  assert.ok(metrics.includes('pct: 100, sessions: Number(tot.completed)'), 'el 100% es reached_end')
})

test('el dashboard renderiza los hitos y el editor del CTA', () => {
  assert.ok(dash.includes('Hitos de visión'))
  assert.ok(dash.includes('milestones.map'))
  assert.ok(dash.includes('ctaEnabled') && dash.includes('ctaAtPercent') && dash.includes('ctaPause'))
})

test('la config por defecto declara los nuevos campos (mergeConfig los fusiona para vídeos viejos)', () => {
  for (const campo of ['ctaEnabled', 'ctaText', 'ctaUrl', 'ctaAtPercent', 'ctaPause', 'ctaOnce']) {
    assert.ok(types.includes(campo), `falta ${campo} en VslConfig`)
  }
  assert.ok(types.includes('ctaEnabled: false'), 'por defecto desactivado (no cambia vídeos existentes)')
})
