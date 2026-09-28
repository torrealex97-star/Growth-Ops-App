import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// PR-R2.2 — REGRESIÓN DE `sales/delete` (borrado compensable) Y `commissions/future`
// (lecturas verificadas). RECOVERY_ROADMAP.md, hallazgos P2 del relevo del 26-sep.
//
// Borrar una venta destruye su dinero (comisiones, devoluciones, cobros). Hasta el 27-sep el
// snapshot que permite reconstruir la venta se construía de lecturas SIN comprobar (un fallo →
// snapshot incompleto → borrado irrecuperable), los desenlaces iban sin verificar y un fallo a
// medias dejaba la venta viva SIN su dinero. En `commissions/future`, las lecturas se tragaban
// como "lista vacía": fallback de % a 5/10, veto pays_commissions (MONEY D9) saltado y FIFO falso
// con importes que nadie ve.
//
// Estilo de la casa (webhook-ghl.test.mjs): invariantes estáticos sobre el código; los comentarios
// se eliminan antes de analizar para que un invariante nunca "pase" por una frase en una nota.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const limpiar = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const borrar = limpiar(read('app/api/[tenant]/evergreen/sales/delete/route.ts'))
const futuras = limpiar(read('app/api/[tenant]/evergreen/commissions/future/route.ts'))

// ── SALES/DELETE ─────────────────────────────────────────────────────────────────────────────

test('el snapshot de auditoría verifica TODAS sus lecturas: un hueco no se borra sin reconstrucción', () => {
  // Es la única vía de recuperación tras borrar. Antes: `const { data: collections } = ...`
  // sin comprobar — un fallo producía un snapshot incompleto y un borrado sin deshacer.
  for (const v of ['collSnapErr', 'commSnapErr', 'refSnapErr', 'contrSnapErr', 'csmSnapErr', 'dropsSnapErr']) {
    assert.ok(borrar.includes(v), `falta comprobar el error de la lectura del snapshot (${v})`)
  }
  assert.ok(borrar.includes('No se pudo preparar el snapshot de auditoría'), 'un snapshot roto no llega a borrar')
  // El audit log de la destrucción sigue bloqueando el borrado si no se puede escribir.
  assert.ok(borrar.includes('No se pudo registrar el borrado'))
})

test('la lectura de la venta fallida no se convierte en "no encontrada" y el 404 sigue existiendo', () => {
  assert.ok(borrar.includes('No se pudo leer la venta'), 'un error de BD no debe reportarse como 404')
  assert.ok(borrar.includes('Venta no encontrada') && borrar.includes('status: 404'))
})

test('los desenlaces se verifican: ninguna referencia colgante silenciosa', () => {
  // Idempotentes, pero silenciar un fallo dejaba contracts/csm_events/drops apuntando a una
  // venta que quizá ya no exista al final del request.
  assert.ok(borrar.includes('No se pudieron desenlazar los registros que referencian la venta'))
  assert.match(borrar, /r\.error \? `\$\{nombresDesenlace\[i\]\}: \$\{r\.error\.message\}`/)
})

test('el borrado del dinero es compensable: si un paso falla, se restaura en orden inverso', () => {
  // Antes: comisiones borradas → si fallaba el resto, la venta quedaba viva SIN su dinero y sin
  // rastro de por qué. Ahora cada paso de borrado tiene su restauración.
  const helper = borrar.slice(borrar.indexOf('async function restaurarDinero'))
  const post = borrar.slice(borrar.indexOf('export async function POST'))
  const llamadas = (post.match(/restaurarDinero\(/g) || []).length
  assert.ok(llamadas === 3, `los tres ramales de fallo (devoluciones, cobros, venta) deben restaurar (hay ${llamadas})`)
  // Orden inverso al borrado (comisiones → devoluciones → cobros): respetar la FK
  // commissions.collection_id al reinsertar. Se busca en el literal del array (la firma del
  // helper también menciona las tres tablas y alteraría los índices).
  const orden = helper.slice(helper.indexOf('const orden ='), helper.indexOf('for (const'))
  const c = orden.indexOf("'collections'")
  const r = orden.indexOf("'refunds'")
  const m = orden.indexOf("'commissions'")
  assert.ok(c > -1 && r > c && m > r, 'la restauración inserta cobros → devoluciones → comisiones')
})

test('la restauración inserta las filas COMPLETAS del snapshot, no ids', () => {
  // El delete por filtro no devuelve las filas: reinsertar solo ids violaría las NOT NULL y
  // la "restauración" fallaría justo cuando más se necesita. El snapshot trae las filas enteras.
  const helper = borrar.slice(
    borrar.indexOf('async function restaurarDinero'),
    borrar.indexOf('export async function POST')
  )
  assert.match(helper, /\.insert\(filas\)/)
  assert.doesNotMatch(borrar, /\.select\('id'\)/, 'ningún delete devuelve filas parciales para restaurar')
})

test('un fallo sin restauración posible ordena NO repetir el borrado y apunta al audit_logs', () => {
  // Si la compensación también falla, la única salida es el snapshot: el mensaje debe impedir
  // que un reintento a ciegas o un arreglo a mano corrompan más datos.
  const veces = (borrar.match(/NO repetir el borrado y NO crear filas a mano/g) || []).length
  assert.ok(veces >= 3, `los tres ramales de fallo deben apuntar a la recuperación (hay ${veces})`)
  assert.ok(borrar.includes('entity_id=${saleId}, action=delete'))
})

// ── COMMISSIONS/FUTURE ───────────────────────────────────────────────────────────────────────

test('commissions/future: ninguna lectura se traga como lista vacía', () => {
  // Antes: un fallo de lectura producía tarifa por defecto 5/10 %, veto D9 saltado (un socio
  // habría visto comisión futura que nunca cobrará) y previsión FIFO con cobros que no existen.
  for (const msg of [
    'No se pudieron leer las reglas de comisión',
    'No se pudieron leer las cuotas pendientes',
    'No se pudieron leer las ventas sin calendario de cuotas',
    'No se pudieron leer los cobros de las ventas sin calendario',
    'No se pudieron leer los planes de pago de las ventas sin calendario',
    'No se pudieron leer los cobros en revisión de comisión',
    'veto pays_commissions de MONEY D9',
  ]) {
    assert.ok(futuras.includes(msg), `falta el guard de lectura: ${msg}`)
  }
})

test('commissions/future: el error de una lectura no se degrada a 404 ni se filtra al cliente', () => {
  // Los guards lanzan dentro del try del handler: el catch responde 500 con el motivo.
  assert.ok(!futuras.includes('status: 404'), 'esta ruta es de lectura: no hay recurso que no encontrar')
  assert.match(futuras, /status: 500/)
})
