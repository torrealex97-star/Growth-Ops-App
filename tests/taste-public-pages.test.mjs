// PASE DE LA SKILL TASTE — superficies públicas (27-sep).
// La skill (`.codebuff/skills/design-taste-frontend/SKILL.md`) manda: un solo acento por página
// (accent lock de la marca), cero emojis en código/copy visible, iconos de una sola librería
// (lucide aquí, ya dependencia del proyecto) y que el copy no hable con el vocabulario de un
// solo tenant. Esto fija el criterio como tests estáticos (mismo patrón que webhook-ghl.test.mjs):
// si alguien reintroduce el drift, la suite avisa.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const LOGIN = join(aqui, '..', 'app', '[tenant]', 'login', 'page.tsx')
const FIRMAR = join(aqui, '..', 'app', 'firmar', '[token]', 'page.tsx')
const FIRMAR_ALUMNO = join(aqui, '..', 'app', 'firmar-alumno', '[token]', 'page.tsx')
const RECOVER = join(aqui, '..', 'app', '[tenant]', 'recover', 'page.tsx')
const REGISTRO = join(aqui, '..', 'app', '[tenant]', 'afiliados', 'registro', 'page.tsx')

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
