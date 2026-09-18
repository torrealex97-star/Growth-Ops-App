import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

// Estética "terminal cinematográfico" del panel selector (app/page.tsx + app/panel.css):
// video full-bleed + scrim + Sora/JetBrains Mono + rectángulos nítidos con el acento de cada tenant.

test('la home lleva el medio cinematográfico con sus atributos completos', () => {
  const home = read('app/page.tsx')
  assert.match(home, /className="go-hero__video"/)
  // Atributos del medio: autoplay sin sonido, en bucle, inline y precargado.
  for (const attr of ['autoPlay', 'muted', 'loop', 'playsInline', 'preload="auto"']) {
    assert.ok(home.includes(attr), `el video debe llevar ${attr}`)
  }
  const css = read('app/panel.css')
  // Full-bleed real: cubre la ventana, nunca inset ni tarjeta.
  assert.match(css, /\.go-hero__video \{[^}]*object-fit: cover;/)
  assert.match(css, /\.go-hero__media \{[^}]*inset: 0;/)
  // Scrim doble (horizontal + vertical) como en el diseño de referencia.
  assert.match(css, /linear-gradient\(\s*to right/)
  assert.match(css, /linear-gradient\(\s*to bottom/)
})

test('tipografías del panel: las del shell, sin cargas nuevas', () => {
  const layout = read('app/layout.tsx')
  // El branding tipográfico de la app NO cambia con el rediseño: ni Sora ni JetBrains Mono.
  assert.doesNotMatch(layout, /Sora|JetBrains_Mono/, 'no se añaden fuentes nuevas al layout raíz')
  assert.match(layout, /variable: '--font-sans'/)
  assert.match(layout, /variable: '--font-display'/)
  const css = read('app/panel.css')
  // El panel consume las variables del shell (Space Grotesk display, Inter UI).
  assert.match(css, /var\(--font-display\)/)
  assert.match(css, /var\(--font-sans\)/)
  assert.doesNotMatch(css, /--font-sora|--font-jbmono/)
})

test('cada tarjeta usa el acento de su tenant vía la fuente única de branding', () => {
  const home = read('app/page.tsx')
  // Misma fuente de verdad que login y shell (resolveTenantBranding), no un color duplicado.
  assert.match(home, /resolveTenantBranding\(t\.settings\)/)
  assert.match(home, /data-accent=\{branding\.accent\}/)
  const css = read('app/panel.css')
  // El acento por defecto de la página es el azul brand (Evergreen)…
  assert.match(css, /--go-accent: hsl\(206 100% 56%\)/)
  // …y la rampa rosa de WDC es la MISMA que [data-accent='pink'] del shell en globals.css.
  const globals = read('app/globals.css')
  const shellPink = globals.match(/\[data-accent='pink'\]\s*\{([^}]*)\}/)?.[1] ?? ''
  const pink500 = shellPink.match(/--brand-500:\s*([\d\s%]+);/)?.[1]?.trim()
  assert.equal(pink500, '335 59% 58%', 'la rampa pink del shell debe seguir siendo la fuente')
  assert.match(css, /--go-accent: hsl\(335 59% 58%\)/)
})

test('reduced-motion: el video se oculta y queda el póster estático', () => {
  const css = read('app/panel.css')
  const desde = css.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(desde > 0, 'debe existir bloque prefers-reduced-motion')
  const bloque = css.slice(desde)
  assert.match(bloque, /\.go-hero__video \{\s*display: none;/)
  assert.match(bloque, /background-image: url\('\/panel\/hero-poster\.png'\)/)
  assert.ok(readFileSync(join(root, 'public/panel/hero-poster.png')).length > 100000, 'el póster existe')
})

test('la estética nueva NO rompe la no-enumeración de subcuentas (§42)', () => {
  const home = read('app/page.tsx')
  // La query de tenants sigue condicionada a haber resuelto la sesión antes.
  assert.match(home, /auth\.getUser\(\)/)
  assert.match(home, /if\s*\(\s*autenticado\s*===?\s*null\s*\)\s*return/)
})

test('rectángulos nítidos: sin border-radius en tarjetas ni chip (estética del brief)', () => {
  const css = read('app/panel.css')
  const tile = css.match(/\.go-tile \{([^}]*)\}/)?.[1] ?? ''
  assert.doesNotMatch(tile, /border-radius/)
  const chip = css.match(/\.go-chip \{([^}]*)\}/)?.[1] ?? ''
  assert.doesNotMatch(chip, /border-radius/)
})
