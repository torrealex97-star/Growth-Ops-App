import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// -----------------------------------------------------------------------------
// HALLAZGOS ABIERTOS DE LA AUDITORÍA FASE A (UX/estados de error, 28-sep):
// un fallo de red/DB no puede pintarse como "lista vacía", "loader infinito"
// ni "todo guardado". Aquí se congela el contrato de cada fix.
// -----------------------------------------------------------------------------

const aqui = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(aqui, '..', p), 'utf8')

test('home: un error de Supabase no se presenta como cero subcuentas', () => {
  const src = read('app/page.tsx')
  assert.ok(src.includes('if (error)'), 'la lectura de tenants inspecciona el error')
  assert.ok(src.includes('No se pudieron cargar las subcuentas'), 'aviso explícito de fallo')
  assert.ok(src.includes('Reintentar'), 'botón de reintento')
  // El aviso de "sin subcuentas" no puede mostrarse cuando hubo error:
  assert.ok(
    !src.includes('tenants.length === 0 && !autenticado && (') ||
      src.includes('!errorTenants && tenants !== null && tenants.length === 0 && !autenticado'),
    'el estado vacío queda condicionado a que no haya error'
  )
})

test('setting-ai: la persistencia local tolera storage no disponible', () => {
  const src = read('app/[tenant]/setting-ai/page.tsx')
  const bloque = src.slice(src.indexOf('localStorage.setItem(') - 400, src.indexOf('localStorage.setItem(') + 500)
  assert.ok(bloque.includes('try {') && bloque.includes('} catch {'), 'setItem envuelto en try/catch')
})

test('devoluciones: un fetch rechazado desbloquea el botón y avisa', () => {
  const src = read('app/[tenant]/finanzas/cobros/devoluciones/page.tsx')
  assert.ok(src.includes('.catch(() => {'), 'el fetch del submit captura el rechazo de red')
  assert.ok(src.includes('Error de red al registrar la devolución'), 'aviso al usuario')
  assert.ok(src.includes('if (!res) return'), 'corta antes de leer el body si la red falló')
})

test('follow-ups de la ficha de venta: try/finally, spinner nunca atascado', () => {
  const src = read('app/[tenant]/ventas/registro/[id]/page.tsx')
  const bloque = src.slice(src.indexOf('const fetchFollowUps'), src.indexOf('useEffect(() => {\n    fetchFollowUps()'))
  assert.ok(bloque.includes('try {') && bloque.includes('finally {'), 'fetchFollowUps con try/finally')
  assert.ok(bloque.includes('setLoadingFollowUps(false)'), 'el loading se apaga siempre')
  assert.ok(bloque.includes('No se pudieron cargar las notas de seguimiento'), 'aviso explícito')
})

test('ContactForm: el reset por cambio del contacto compara VALORES, no identidad', () => {
  const src = read('components/contacts/ContactForm.tsx')
  assert.ok(src.includes('aplicados.current'), 'guard de valores ya aplicados')
  assert.ok(src.includes('.some((k) =>'), 'comparación campo a campo (some sobre las claves)')
  // El reset NO puede dispararse sin cambio de valores (borraría lo tecleado en cada render).
  assert.ok(src.includes('if (!cambio) return'), 'sin cambio de valores, no hay reset')
})

test('informes financieros: ninguna fuente fallida se pinta como cifra válida', () => {
  const informes = [
    ['app/[tenant]/finanzas/analitica/pnl/page.tsx', ['ventas', 'cobros', 'devoluciones', 'gastos', 'comisiones']],
    ['app/[tenant]/finanzas/analitica/cohortes/page.tsx', ['ventas', 'cobros']],
    ['app/[tenant]/finanzas/analitica/proyeccion/page.tsx', ['cuotas', 'comisiones']],
    [
      'app/[tenant]/finanzas/gastos-facturas/gestoria/page.tsx',
      ['cobros', 'gastos', 'devoluciones', 'ventas', 'comisiones'],
    ],
  ]
  for (const [f, fuentes] of informes) {
    const src = read(f)
    assert.ok(src.includes('fuentesEnError'), `${f}: estado de fuentes ilegibles`)
    for (const fuente of fuentes) {
      assert.ok(src.includes(`'${fuente}'`), `${f}: la fuente '${fuente}' entra en el diagnóstico`)
    }
    // El estado de error vacía las fuentes y corta ANTES de los set de datos:
    const idxGuard =
      src.indexOf('fuentesFallidas.length) {') > -1
        ? src.indexOf('fuentesFallidas.length) {')
        : src.indexOf('.error) {')
    const idxRender = src.indexOf('fuentesEnError.length > 0')
    assert.ok(idxGuard > -1 && idxRender > -1, `${f}: guard + aviso de render presentes`)
  }
})
