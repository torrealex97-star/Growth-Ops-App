import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const MODULOS = readdirSync(join(root, 'lib/commissions'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => `lib/commissions/${f}`)

// Este módulo se quedó FUERA de la migración multi-tenant: `tenant_id` no aparecía ni una vez.
// Con un cliente service-role (que salta RLS) eso significaba leer las reglas de comisión de TODAS
// las subcuentas, sumar el cash collected de todas para decidir el tramo, y poder reescribir el %
// de comisiones ajenas. Estos tests son el cerrojo para que no vuelva a pasar.
test('toda consulta de comisiones va acotada por tenant_id', () => {
  const TABLAS_MULTITENANT = [
    'commissions',
    'commission_rules',
    'collections',
    'refunds',
    'sales',
    'sales_tramos',
    'sales_tramos_config',
    'appointments',
    'contact_attributions',
  ]
  for (const modulo of MODULOS) {
    const code = sinComentarios(read(modulo))
    // Cada `.from('tabla')` de una tabla multitenant tiene que llevar su filtro de subcuenta en la
    // misma cadena de consulta (hasta el siguiente `await`/fin de sentencia).
    const regex = /\.from\('([a-z_]+)'\)([\s\S]*?)(?=\n\n|\n  const |\n  await |\n  return |$)/g
    let m
    while ((m = regex.exec(code)) !== null) {
      const [, tabla, cadena] = m
      if (!TABLAS_MULTITENANT.includes(tabla)) continue
      // Un INSERT no filtra: lleva la subcuenta EN LA FILA. Que la lleve lo comprueba
      // tests/metrics/commissions-tenant.test.mjs sobre las filas que produce la calculadora.
      if (/^\s*\.insert\(/.test(cadena)) continue
      assert.match(
        cadena,
        /tenant_id/,
        `${modulo}: la consulta a '${tabla}' no filtra por tenant_id — con service-role eso cruza subcuentas`
      )
    }
  }
})

// `commissions.tenant_id` es NOT NULL: una fila sin él NO se puede insertar. El insert fallaba
// siempre, el error se descartaba (`await sb.from('commissions').insert(rows)` a secas) y la ruta
// devolvía el nº de comisiones CALCULADAS. La pantalla prometía dinero que no existía en la BBDD.
test('ninguna escritura de comisiones descarta su error', () => {
  for (const modulo of MODULOS) {
    const code = sinComentarios(read(modulo))
    const lineas = code.split('\n')
    for (const [i, linea] of lineas.entries()) {
      if (!/\.(insert|upsert|update|delete)\(/.test(linea)) continue
      // La escritura tiene que asignarse (para mirar `error`) en vez de ejecutarse a ciegas.
      const bloque = lineas.slice(Math.max(0, i - 6), i + 10).join('\n')
      assert.match(
        bloque,
        /(const|let)\s*\{[^}]*error/,
        `${modulo}:${i + 1}: escritura sin comprobar el error → un fallo pasa por éxito`
      )
    }
  }
})

// El nº que ve el usuario tiene que ser el nº de filas escritas, no el de filas calculadas.
test('se informa de las comisiones escritas, no de las calculadas', () => {
  const code = sinComentarios(read('lib/commissions/generate.ts'))
  assert.doesNotMatch(code, /return commissions\.length/)
  assert.match(code, /inserted = data\?\.length \?\? 0/)
  assert.match(code, /return inserted/)
})

// `users` es una tabla GLOBAL: la pertenencia a una subcuenta vive en `tenant_members`. Resolver un
// utm_term o un email sin comprobarla atribuía la agenda —y su comisión— a alguien de otra.
test('la atribución por código o email exige pertenencia a la subcuenta', () => {
  const tracking = sinComentarios(read('lib/tracking.ts'))
  assert.match(tracking, /tenant_members/)
  assert.match(tracking, /export async function firstMemberOf/)
  assert.match(tracking, /tenantId: string/)
  for (const ruta of [
    'app/api/[tenant]/evergreen/webhooks/calendly/route.ts',
    'app/api/[tenant]/evergreen/webhooks/ghl/route.ts',
  ]) {
    const code = sinComentarios(read(ruta))
    assert.match(code, /firstMemberOf\(/, `${ruta} resuelve usuarios sin acotar la subcuenta`)
    assert.doesNotMatch(
      code,
      /resolveUserIdByTrackingCode\(sb, utm\.utm_term\)/,
      `${ruta} resuelve el utm_term sin subcuenta`
    )
  }
})

// Una sola implementación canónica por operación de negocio. Estas dos pantallas escribían
// directamente en la base de datos desde el navegador, en paralelo a las rutas que ya hacían lo
// mismo — y peor: sin tramos, sin atribución por UTM, sin recalcular el nivel del rep y, en el caso
// de las devoluciones, SIN COMPROBAR LA VENTANA DE 15 DÍAS.
test('registrar un cobro o una devolución pasa por su ruta canónica', () => {
  const cobro = sinComentarios(read('app/[tenant]/finanzas/cobros/cobros/new/page.tsx'))
  assert.match(cobro, /\/evergreen\/collections\/record/)
  for (const escritura of ["from('collections').insert", "from('commissions').insert"]) {
    assert.ok(!cobro.includes(escritura), `la pantalla de cobros vuelve a escribir a mano: ${escritura}`)
  }

  const devolucion = sinComentarios(read('app/[tenant]/finanzas/cobros/devoluciones/page.tsx'))
  assert.match(devolucion, /\/evergreen\/refunds\/create/)
  for (const escritura of ["from('refunds').insert", "from('commissions').insert"]) {
    assert.ok(!devolucion.includes(escritura), `la pantalla de devoluciones vuelve a escribir a mano: ${escritura}`)
  }
})

// La ventana de devolución es una regla de negocio, no un aviso: solo se salta con `override`
// explícito, y la venta tiene que quedar marcada como devuelta de verdad.
test('la ruta de devoluciones valida plazo, importe y que la venta quede marcada', () => {
  const code = sinComentarios(read('app/api/[tenant]/evergreen/refunds/create/route.ts'))
  assert.match(code, /outOfWindow: true/)
  assert.match(code, /!withinWindow && !override/)
  assert.match(code, /grossRefund > totalGross \+ 0\.01/)
  assert.match(code, /refundDate > hoy/, 'una devolución con fecha futura descuadra el P&L')
  assert.match(code, /from\('sales'\)[\s\S]{0,300}\.select\('id'\)/, 'hay que comprobar que la venta se marcó')
  assert.match(code, /recomputeRepCommissionTiers\(sb, t\.tenantId/)
})

// El cobro queda auditado por la ruta, no según por qué pantalla se haya entrado.
test('la ruta de cobros deja auditoría', () => {
  const code = sinComentarios(read('app/api/[tenant]/evergreen/collections/record/route.ts'))
  assert.match(code, /from\('audit_logs'\)\.insert/)
  assert.match(code, /entity_type: 'collection'/)
})

// La reparación contable no puede vivir en la consola del navegador. Las comisiones de todo cobro
// anterior al arreglo del tenant_id nunca se escribieron, y arreglar el código no las rellena: hay
// que reconciliar. El botón dispara la ruta canónica, solo para quien puede aprobar comisiones.
test('reparar comisiones es un botón de la app, no un fetch a mano', () => {
  const page = read('app/[tenant]/comisiones/page.tsx')
  const code = sinComentarios(page)
  assert.match(code, /\/evergreen\/sales\/reconcile-all/, 'no llama a la ruta canónica')
  assert.match(code, /canApprove && \(/, 'el botón no está limitado a admin/director')
  assert.match(page, /Reparar comisiones/)
  // Y es honesto cuando la función agota su ventana: parte del trabajo sí se aplicó.
  assert.match(code, /res\.status === 504/, 'un timeout no puede leerse como "no se hizo nada"')
  // La ruta sigue exigiendo rol financiero y acota por subcuenta.
  const route = sinComentarios(read('app/api/[tenant]/evergreen/sales/reconcile-all/route.ts'))
  assert.match(route, /\['admin', 'director'\]\.includes\(role \|\| ''\)/)
  assert.match(route, /reconcileSaleCommissions\(sb, tenantId, id/)
})
