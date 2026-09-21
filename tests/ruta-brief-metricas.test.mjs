import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const RUTA = 'app/api/[tenant]/evergreen/metricas/brief/route.ts'
const CONSULTA = 'lib/metrics/consulta.ts'

// ---------------------------------------------------------------------------------------------
// AISLAMIENTO. Es lo primero porque es lo único que no se puede arreglar después.
// ---------------------------------------------------------------------------------------------

test('la ruta exige sesión y subcuenta antes de leer nada', () => {
  const codigo = sinComentarios(leer(RUTA))
  const auth = codigo.indexOf('requireTenant(tenant)')
  const lectura = codigo.indexOf('consultarMetricas(')
  assert.ok(auth > -1 && auth < lectura, 'la autorización tiene que ir antes de la consulta')
})

test('lee con la sesión del usuario, no con service_role', () => {
  const codigo = sinComentarios(leer(RUTA))
  // No hace falta saltar RLS para leer métricas: con el cliente del usuario, el aislamiento lo sostiene
  // la base y no la memoria de quien escribió la consulta.
  assert.doesNotMatch(codigo, /SERVICE_ROLE/)
  assert.match(codigo, /await createClient\(\)/)
})

test('cada consulta filtra por tenant_id explícitamente, conteos incluidos', () => {
  const codigo = sinComentarios(leer(CONSULTA))
  // Incluye los conteos de atribución: un conteo sin filtrar por subcuenta diría cuántos contactos tiene
  // OTRO cliente, que es una fuga aunque solo sea un número.
  const tablas = (codigo.match(/\.from\('(\w+)'\)/g) || []).length
  const filtros = (codigo.match(/\.eq\('tenant_id', tenantId\)/g) || []).length
  assert.equal(filtros, tablas, `${tablas} tablas y solo ${filtros} filtros por subcuenta`)
})

// ---------------------------------------------------------------------------------------------
// PAGINACIÓN. PostgREST devuelve 1.000 filas como máximo y NO avisa de que ha recortado.
// ---------------------------------------------------------------------------------------------

test('todas las lecturas de FILAS pasan por el paginador', () => {
  const codigo = sinComentarios(leer(CONSULTA))
  // Las consultas de solo conteo (`head: true`) no devuelven filas, así que no hay nada que paginar:
  // PostgREST manda el total en una cabecera. Se excluyen a propósito, y por eso se cuentan aparte en vez
  // de relajar la comprobación — si se relajara, una lectura de filas sin paginar se colaría sin ruido.
  const froms = (codigo.match(/\.from\('/g) || []).length
  const conteos = (codigo.match(/head: true/g) || []).length
  const paginadas = (codigo.match(/fetchAllRows</g) || []).length
  assert.equal(paginadas, froms - conteos, `${froms} consultas, ${conteos} de conteo, ${paginadas} paginadas`)
  assert.ok(conteos > 0, 'los conteos de atribución deberían usar head: true y no traerse las filas')
  // Y un recorte se declara: una suma incompleta que no avisa es el fallo más caro de esta base.
  assert.match(codigo, /fuentesRecortadas/)
})

test('las lecturas de métricas van en paralelo', () => {
  assert.match(sinComentarios(leer(CONSULTA)), /await Promise\.all\(\[/)
})

// ---------------------------------------------------------------------------------------------
// UN ERROR DE LECTURA NO ES UN CERO. Devolver 0 € de facturación porque falló la red es el peor
// resultado posible: nadie lo distingue de haber vendido cero.
// ---------------------------------------------------------------------------------------------

test('las fuentes que fallan se declaran y acaban en una alerta de calidad de dato', () => {
  assert.match(sinComentarios(leer(CONSULTA)), /fuentesConError/)
  const ruta = sinComentarios(leer(RUTA))
  assert.match(ruta, /for \(const f of consulta\.fuentesConError\)/)
  assert.match(ruta, /alertaCalidadDato\(/)
})

test('el nombre de las columnas es el real, no el que uno recuerda', () => {
  const codigo = leer(CONSULTA)
  // El importe de un cobro está en gross_amount. Con `amount`, el cash collected sale 0 € sin que
  // ninguna consulta falle.
  assert.match(codigo, /collected_at, gross_amount, is_confirmed/)
  assert.doesNotMatch(sinComentarios(codigo), /select\('[^']*\bamount\b[^']*'\)/)
  // Y las respuestas del formulario están en raw_payload, no en qualification (0 de 559 en producción).
  assert.match(codigo, /qualification, raw_payload/)
  // Speed to Lead sale de dos timestamps reales del contacto; no de la fecha de la cita ni de una
  // aproximación inventada en el frontend. El periodo se acota por FECHA REAL (first_seen_at con
  // COALESCE a created_at): created_at es la fecha de importación de GHL, no la del lead.
  assert.match(codigo, /created_at, first_seen_at, first_contact_at/)
  assert.match(codigo, /first_seen_at\.gte\./)
})

// ---------------------------------------------------------------------------------------------
// NO SE INVENTAN NÚMEROS PARA QUE LA TARJETA TENGA ALGO.
// ---------------------------------------------------------------------------------------------

test('el ticket medio para estimar impacto sale de datos reales o no se usa', () => {
  const codigo = sinComentarios(leer(RUTA))
  assert.match(codigo, /consulta\.agregados\.aov\?\.valor \?\? contexto\?\.precioOfertaEur \?\? null/)
})

test('la utilización de capacidad solo se calcula si alguien declaró la capacidad', () => {
  const codigo = sinComentarios(leer(RUTA))
  assert.match(codigo, /contexto\?\.capacidadLlamadasSemana &&/)
  assert.match(codigo, /utilizacionVentas:/)
  // Sin ese dato va null, y el motor devuelve con_cautela en vez de luz verde.
  assert.match(codigo, /: null,/)
})

test('las alertas salen de las mismas métricas que el diagnóstico, no de un segundo cálculo', () => {
  const codigo = sinComentarios(leer(RUTA))
  assert.match(codigo, /for \(const m of metricas\)/)
  // Si se recalcularan aquí, el panel podría avisar de algo que el diagnóstico no ve.
  assert.match(codigo, /const metricas = entradasDiagnostico\(consulta\.agregados\)/)
  assert.ok(codigo.indexOf('const metricas =') < codigo.indexOf('for (const m of metricas)'))
})

// El aviso que más vale hoy: 328 citas pasadas sin marcar en producción.
test('avisa de las llamadas ya celebradas sin marcar', () => {
  const codigo = sinComentarios(leer(RUTA))
  assert.match(codigo, /coberturaMarcado\(consulta\.citas, periodo\)/)
  assert.match(codigo, /marcado\.pasadasSinMarcar > 0/)
  assert.match(codigo, /key: 'marcado_agendas'/)
})

test('las fechas se validan en vez de confiar en ellas', () => {
  const codigo = sinComentarios(leer(RUTA))
  assert.match(codigo, /FECHA\.test\(desde\)/)
  assert.match(codigo, /periodo\.desde > periodo\.hasta/)
})

// ---------------------------------------------------------------------------------------------
// AUDITABILIDAD: sin las mediciones en crudo, la nota de salud vuelve a ser un número indiscutible.
// ---------------------------------------------------------------------------------------------

test('la respuesta permite auditar de dónde sale cada número', () => {
  const codigo = sinComentarios(leer(RUTA))
  assert.match(codigo, /mediciones: consulta\.agregados/)
  assert.match(codigo, /filasLeidas: consulta\.filasLeidas/)
  assert.match(codigo, /ticketMedioUsado: ticketMedio/)
  assert.match(codigo, /requestId: auth\.requestId/)
})

// ---------------------------------------------------------------------------------------------
// EL HUECO DE ATRIBUCIÓN, DICHO EN VEZ DE CALLADO.
//
// `contact_attributions` está a 0 filas y `contacts.campaign_id` a 0 de 956 en producción, porque los
// enlaces de reserva no llevan UTMs. Sin origen no hay CAC por canal ni se puede separar lo orgánico de
// los anuncios, y un panel que enseña un CAC global sin decirlo deja creer que sí se sabe.
// ---------------------------------------------------------------------------------------------

test('la atribución se cuenta y se avisa con números exactos', () => {
  const consulta = sinComentarios(leer(CONSULTA))
  assert.match(consulta, /from\('contact_attributions'\)/)
  assert.match(consulta, /head: true/)
  const ruta = sinComentarios(leer(RUTA))
  assert.match(ruta, /key: 'atribucion_contactos'/)
  assert.match(ruta, /contactos > 0 && conAtribucion < contactos/)
  assert.match(ruta, /de \$\{contactos\} contactos tienen origen conocido/)
})

test('el aviso dice qué hacer, y que sin captura no hay nada que atribuir', () => {
  const ruta = leer(RUTA)
  assert.match(ruta, /parámetros UTM a los enlaces/)
  assert.match(ruta, /no hay nada que atribuir/)
})

// Los webhooks registran el toque, y un fallo al atribuir no puede tumbar la cita.
test('los webhooks registran el toque sin arriesgar la cita', () => {
  for (const w of [
    'app/api/[tenant]/evergreen/webhooks/calendly/route.ts',
    'app/api/[tenant]/evergreen/webhooks/ghl/route.ts',
  ]) {
    const codigo = sinComentarios(leer(w))
    assert.match(codigo, /registrarToque\(sb, tenantId, contact\.id/, w)
    // Guard: registra si hay datos de toque O si viene ?ref= de colaborador (FK estructurada).
    assert.match(codigo, /if \(colaboradorId \|\| toqueTieneDatos\(toque\)\)/, w)
    // En try/catch: la cita y el contacto valen más que su procedencia.
    assert.match(codigo, /try \{[\s\S]{0,320}registrarToque[\s\S]{0,200}\} catch/, w)
  }
})
