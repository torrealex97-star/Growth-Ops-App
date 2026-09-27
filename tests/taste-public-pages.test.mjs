// PASE DE LA SKILL TASTE — superficies públicas (27-sep).
// La skill (`.codebuff/skills/design-taste-frontend/SKILL.md`) manda: un solo acento por página
// (accent lock de la marca), cero emojis en código/copy visible, iconos de una sola librería
// (lucide aquí, ya dependencia del proyecto) y que el copy no hable con el vocabulario de un
// solo tenant. Esto fija el criterio como tests estáticos (mismo patrón que webhook-ghl.test.mjs):
// si alguien reintroduce el drift, la suite avisa.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const LOGIN = join(aqui, '..', 'app', '[tenant]', 'login', 'page.tsx')
const FIRMAR = join(aqui, '..', 'app', 'firmar', '[token]', 'page.tsx')
const FIRMAR_ALUMNO = join(aqui, '..', 'app', 'firmar-alumno', '[token]', 'page.tsx')
const RECOVER = join(aqui, '..', 'app', '[tenant]', 'recover', 'page.tsx')
const REGISTRO = join(aqui, '..', 'app', '[tenant]', 'afiliados', 'registro', 'page.tsx')
const VER_COMO = join(aqui, '..', 'app', 'ver-como', 'entrar', 'page.tsx')

const faltan = [LOGIN, FIRMAR, FIRMAR_ALUMNO, RECOVER, REGISTRO].filter((p) => !existsSync(p))
if (faltan.length > 0) {
  console.log('skip: superficies públicas no presentes en este checkout (se ejecuta desde el repo)')
  process.exit(0)
}

const read = (p) => readFileSync(p, 'utf8')

test('login: el monograma usa la inicial REAL del branding, no una letra fija de otra marca', () => {
  const src = read(LOGIN)
  // Derivada de resolveTenantBranding → inicial dinámica.
  assert.ok(src.includes('.charAt(0)'), 'la inicial debe derivarse del nombre de la subcuenta')
  assert.ok(src.includes('.toUpperCase()'), 'la inicial debe normalizarse a mayúscula')
  // La "S" fija era la inicial de otra marca: en cada login mentía sobre dónde estabas.
  assert.ok(!src.includes('>S</span>'), 'no debe quedar un monograma con letra fija')
})

test('firmar: éxito sin glifo de texto y checkbox de consentimiento dentro del sistema (zinc)', () => {
  const src = read(FIRMAR)
  assert.ok(!src.includes('✓'), 'el check de éxito es un icono de librería, no un glifo de texto')
  assert.ok(src.includes('CheckCircle2'), 'el estado firmado usa el icono CheckCircle2')
  assert.ok(!src.includes('accent-emerald-600'), 'el acento interactivo de la página es zinc, no esmeralda')
  assert.ok(src.includes('accent-zinc-900'), 'el checkbox de consentimiento usa el acento zinc-900')
})

test('firmar-alumno: sin emoji de celebración y con copys neutros (sin vocabulario de un solo tenant)', () => {
  const src = read(FIRMAR_ALUMNO)
  assert.ok(!src.includes('🎉'), 'la celebración usa el icono de librería, no un emoji')
  assert.ok(src.includes('CheckCircle2'), 'el estado firmado usa el icono CheckCircle2')
  assert.ok(!src.includes('Winner'), 'el copy no debe llamar al alumno con el nombre de una marca concreta')
  assert.ok(!src.includes('Academia'), 'el copy no debe nombrar un producto concreto de una subcuenta')
})

test('las cuatro pantallas comparten la misma gramática de éxito (CheckCircle2 esmeralda)', () => {
  const registro = read(REGISTRO)
  const recover = read(RECOVER)
  assert.ok(registro.includes('CheckCircle2') && recover.includes('CheckCircle2'))
  assert.ok(registro.includes('text-emerald-400') && recover.includes('text-emerald-400'))
})

// LOTE 2 (27-sep): audit-first de marketing dio veredicto «preservar» (esmeralda = convención de
// la casa para positivo/dinero; labels uppercase funcionales), así que no hay invariantes de
// acento para esas pantallas — se fijan aquí los que sí cambiaron y los que NO deben cambiar.
test('ver-como/entrar usa la familia zinc de la casa, no neutral', () => {
  const src = read(VER_COMO)
  assert.ok(src.includes('bg-zinc-950'), 'el fondo de la página puente usa zinc-950 como global-error')
  assert.ok(!src.includes('neutral-'), 'ninguna superficie pública usa la familia neutral (§4.2: una paleta de grises)')
  assert.ok(src.includes('focus-visible:ring'), 'el botón Volver tiene foco de teclado visible')
})

// LOTE 3 (27-sep) — deuda UX R4: REQ-UX-02 (familia zinc en el shell), REQ-UX-03 (tokens
// tipográficos en config, no arbitrarios sueltos) y REQ-UX-05 (modales con el Dialog de la casa).
const SIDEBAR = join(aqui, '..', 'components', 'os', 'Sidebar.tsx')
const TENANT_LAYOUT = join(aqui, '..', 'app', '[tenant]', 'layout.tsx')
const TAILWIND = join(aqui, '..', 'tailwind.config.ts')
const MODALES_LOTE3 = [
  'app/[tenant]/tasks/page.tsx',
  'app/[tenant]/csm-events/page.tsx',
  'app/[tenant]/contratos/page.tsx',
  'app/[tenant]/drops/page.tsx',
  'app/[tenant]/recursos/biblioteca/page.tsx',
].map((r) => join(aqui, '..', r))

// Recolecta los .tsx bajo un directorio (para invariante global de la base de código).
const walkTsx = (dir, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walkTsx(p, acc)
    else if (e.name.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

test('el shell (sidebar + layout) vive en zinc, sin hexes ni SVG dibujados a mano (REQ-UX-02)', () => {
  const sidebar = read(SIDEBAR)
  assert.ok(
    !/#[0-9a-fA-F]{3,8}\b/.test(sidebar),
    'el shell no debe usar hexes: zinc cubre la paleta (los hexes quedan para HTML de email y data-viz)'
  )
  const layout = read(TENANT_LAYOUT)
  assert.ok(layout.includes('AlertTriangle'), 'el aviso de suplantación usa el icono AlertTriangle de lucide')
  assert.ok(layout.includes('text-red-400'), 'el icono conserva el rojo de estado que tenía el SVG a mano')
  assert.ok(!layout.includes('<svg'), 'no quedan SVG dibujados a mano en el layout del shell')
})

test('los tamaños pequeños usan los tokens text-3xs/text-2xs, no arbitrarios (REQ-UX-03)', () => {
  const cfg = read(TAILWIND)
  assert.ok(cfg.includes("'3xs': '10px'"), 'el token text-3xs (10px) debe existir en theme.extend.fontSize')
  assert.ok(cfg.includes("'2xs': '11px'"), 'el token text-2xs (11px) debe existir en theme.extend.fontSize')
  const raiz = join(aqui, '..')
  const conArbitrario = [join(raiz, 'app'), join(raiz, 'components')]
    .flatMap((dir) => (existsSync(dir) ? walkTsx(dir) : []))
    .filter((f) => /text-\[1[01]px\]/.test(read(f)))
  assert.ok(
    conArbitrario.length === 0,
    `no debe quedar text-[10px]/text-[11px] fuera del token (en: ${conArbitrario.slice(0, 3).join(', ')})`
  )
})

test('los modales migrados al Dialog de la casa no vuelven a overlays caseros (REQ-UX-05)', () => {
  for (const f of MODALES_LOTE3) {
    const src = read(f)
    assert.ok(
      !src.includes('fixed inset-0'),
      `${f}: los modales de la casa van sobre components/ui/dialog (Radix: foco, Esc, click-fuera gratis)`
    )
    assert.ok(src.includes("from '@/components/ui/dialog'"), `${f}: debe usar el Dialog de la casa`)
  }
})
