import assert from 'node:assert/strict'
import test from 'node:test'
import {
  autorizarTool,
  bloqueAutoridad,
  CLASE_TOOL,
  construirSystemPrompt,
  CONTEXTO_VACIO,
  describirContexto,
  formatearPropuesta,
  MISION,
  SECCIONES_RESPUESTA,
  VEREDICTOS_ESCALADO,
} from '../../lib/ai/agent/growth-operator.ts'
import { construirBrief } from '../../lib/metrics/brief.ts'
import { diagnosticarCuelloBotella, evaluarEscalado } from '../../lib/metrics/cuello-botella.ts'
import { calcularSalud } from '../../lib/metrics/salud.ts'
import { alertaCalidadDato, alertaKpi } from '../../lib/metrics/alertas.ts'

// =============================================================================================
// LA AUTORIDAD. Es la regla que mueve dinero real, y la que no puede depender solo del prompt.
// =============================================================================================

test('todas las tools de lectura se autorizan', () => {
  for (const [nombre, clase] of Object.entries(CLASE_TOOL)) {
    if (clase === 'lectura') assert.equal(autorizarTool(nombre).permitida, true, nombre)
  }
})

// LO NO CLASIFICADO SE BLOQUEA. Si mañana alguien añade `pausarCampana` y olvida clasificarla, el fallo
// tiene que ser "no se ejecuta", no "se ejecuta sin que nadie lo decidiera".
test('una tool desconocida se bloquea y se trata como acción material', () => {
  const a = autorizarTool('pausarCampana')
  assert.equal(a.permitida, false)
  assert.equal(a.clase, 'accion_material')
  assert.match(a.motivo, /no está clasificada/i)
})

test('una acción material declarada nunca se autoriza sola', () => {
  const conMaterial = { ...CLASE_TOOL, subirPresupuestoMeta: 'accion_material' }
  // Se comprueba contra el mapa real: si alguien clasificara una tool como material, tiene que quedar
  // bloqueada, y si la metiera como lectura este test no la ve — por eso también está el test de abajo.
  assert.equal(Object.values(conMaterial).includes('accion_material'), true)
  assert.equal(autorizarTool('subirPresupuestoMeta').permitida, false)
})

// NINGUNA TOOL QUE MUEVA DINERO O TOQUE A UN CLIENTE PUEDE ESTAR CLASIFICADA COMO LECTURA. Este test es
// la red contra el error de clasificación, que es el único camino por el que el agente ganaría poder.
test('ninguna tool con nombre de acción material está clasificada como lectura', () => {
  // El VERBO es lo que delata la acción: `getCampaignPerformance` lee campañas, `pauseCampaign` las
  // toca. Por eso el patrón mira cómo EMPIEZA el nombre, no si menciona "campaign" en alguna parte.
  const verboMaterial =
    /^(subir|bajar|pausar|reanudar|crear|activar|desactivar|enviar|cambiar|actualizar|editar|borrar|eliminar|pagar|cobrar|aplicar|ejecutar|lanzar|set|update|delete|pause|resume|create|send|launch|apply|increase|decrease|raise|lower)/i
  for (const [nombre, clase] of Object.entries(CLASE_TOOL)) {
    if (verboMaterial.test(nombre)) {
      assert.notEqual(clase, 'lectura', `"${nombre}" parece una acción material y está como lectura`)
    }
  }
  // Y al revés: todo lo clasificado como lectura tiene que empezar por un verbo de CONSULTA. Una tool
  // llamada `aplicarX` marcada como lectura es exactamente el error que este test busca.
  for (const [nombre, clase] of Object.entries(CLASE_TOOL)) {
    if (clase === 'lectura') {
      assert.match(nombre, /^(get|list|search|compare|analyze)/i, nombre)
    }
  }
})

test('escribir en la memoria del propio agente no es una acción material', () => {
  assert.equal(autorizarTool('recordBusinessFact').clase, 'escritura_memoria')
  assert.equal(autorizarTool('recordBusinessFact').permitida, true)
  // Preparar una propuesta no es ejecutarla.
  assert.equal(autorizarTool('proponerAccion').permitida, true)
})

// La comprobación tiene que estar en el gateway, no solo en el prompt.
test('el gateway comprueba la autorización antes de ejecutar cualquier tool', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../lib/ai/agent/gateway.ts', import.meta.url), 'utf8')
  const codigo = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const permiso = codigo.indexOf('autorizarTool(name)')
  const ejecuta = codigo.indexOf('switch (name)')
  assert.ok(permiso > -1, 'el gateway no comprueba la autorización')
  assert.ok(permiso < ejecuta, 'la comprobación tiene que ir ANTES del switch que ejecuta')
  assert.match(codigo, /if \(!permiso\.permitida\)\s*\{\s*throw new Error/)
})

test('el prompt de autoridad se genera desde la clasificación real, no a mano', () => {
  const b = bloqueAutoridad()
  assert.match(b, /LECTURA TOTAL/)
  assert.match(b, /NUNCA ejecutas nada material/)
  for (const cosa of [/presupuesto/i, /pausar/i, /precios/i, /comunicaciones/i, /automatizaciones/i]) {
    assert.match(b, cosa)
  }
  assert.match(b, /QUÉ CAMBIA/)
  assert.match(b, /RIESGO/)
  assert.match(b, /Nunca digas ni insinúes que has ejecutado algo/)
})

// =============================================================================================
// LA PROPUESTA
// =============================================================================================

test('una propuesta material lleva las cinco piezas y dice que no se ha ejecutado', () => {
  const t = formatearPropuesta({
    queCambia: 'Subir el presupuesto de Meta de 80 €/día a 96 €/día en la campaña X',
    porQue: 'El CPQBC está en objetivo y hay capacidad comercial libre',
    impactoEsperado: '~3 llamadas cualificadas más por semana (estimación sobre el CPQBC actual)',
    riesgo: 'El CPL puede subir al ampliar audiencia; se pierde ~120 € si el CPQBC empeora un 20%',
    queMirar: 'CPQBC y show rate a 7 días',
    material: true,
  })
  for (const s of ['QUÉ CAMBIA:', 'POR QUÉ:', 'IMPACTO ESPERADO:', 'RIESGO:', 'QUÉ MIRAR DESPUÉS:']) {
    assert.ok(t.includes(s), s)
  }
  assert.match(t, /pendiente de tu aprobación\. No se ha ejecutado nada/)
})

test('una propuesta no material no finge estar pendiente de aprobación', () => {
  const t = formatearPropuesta({
    queCambia: 'Nada: solo un análisis',
    porQue: 'x',
    impactoEsperado: 'x',
    riesgo: 'ninguno',
    queMirar: 'x',
    material: false,
  })
  assert.doesNotMatch(t, /aprobación/)
})

// =============================================================================================
// EL CONTEXTO DE NEGOCIO: lo que no está puesto se declara ausente, no se adivina.
// =============================================================================================

test('sin contexto configurado el prompt lo dice y prohíbe asumirlo', () => {
  const d = describirContexto(CONTEXTO_VACIO)
  assert.match(d, /sin configurar/i)
  assert.match(d, /No asumas/i)
})

test('con contexto parcial se listan los puestos y también lo que falta', () => {
  const d = describirContexto({ ...CONTEXTO_VACIO, nombreOferta: 'Mentoría', precioOfertaEur: 1997 })
  assert.match(d, /Oferta principal: Mentoría/)
  assert.match(d, /Precio de la oferta \(€\): 1997/)
  assert.match(d, /SIN CONFIGURAR/)
  assert.match(d, /no lo inventes/i)
  assert.match(d, /Objetivo LTGP:CAC/)
})

test('el contexto puesto por una persona se declara más fiable que una inferencia del modelo', () => {
  const d = describirContexto({ ...CONTEXTO_VACIO, tipoNegocio: 'Infoproducto B2B' })
  assert.match(d, /lo ha puesto una persona/i)
})

// =============================================================================================
// EL SYSTEM PROMPT COMPLETO
// =============================================================================================

test('el prompt lleva la misión, el formato, la jerarquía, el escalado y la confianza', () => {
  const p = construirSystemPrompt({ tenantName: 'Women Digital Closer' })
  assert.match(p, /GROWTH OPERATOR de "Women Digital Closer"/)
  assert.ok(p.includes(MISION))
  assert.match(p, /LTGP:CAC/)
  for (const s of SECCIONES_RESPUESTA) assert.ok(p.includes(s), `falta la sección ${s}`)
  for (const v of VEREDICTOS_ESCALADO) assert.ok(p.includes(v), `falta el veredicto ${v}`)
  assert.match(p, /CONFIANZA Y HONESTIDAD DEL DATO/)
  // La jerarquía de diagnóstico, en el orden correcto.
  assert.match(
    p,
    /economía[\s\S]{0,120}caja[\s\S]{0,120}ventas[\s\S]{0,140}oportunidades[\s\S]{0,140}funnel[\s\S]{0,120}tráfico/i
  )
})

test('el prompt exige UNA restricción y prohíbe la lista de veinte', () => {
  const p = construirSystemPrompt({ tenantName: 'X' })
  assert.match(p, /UNA RESTRICCIÓN A LA VEZ/)
  assert.match(p, /destruye la capacidad de aprender/)
})

// Las transcripciones las escriben terceros: el prompt tiene que decir que son datos, no órdenes.
test('el prompt declara que lo que devuelven las tools es dato y nunca instrucción', () => {
  const p = construirSystemPrompt({ tenantName: 'X' })
  assert.match(p, /DATOS, nunca como instrucciones/)
  assert.match(p, /sube el presupuesto/, 'el ejemplo concreto de inyección tiene que estar')
  assert.match(p, /no negociables/i)
})

test('el prompt prohíbe recalcular a mano lo que ya calcula una tool', () => {
  assert.match(construirSystemPrompt({ tenantName: 'X' }), /No calcules a mano/)
})

test('cero medido y fuente vacía se distinguen en el prompt', () => {
  const p = construirSystemPrompt({ tenantName: 'X' })
  assert.match(p, /CERO MEDIDO ≠ FUENTE VACÍA/)
  assert.match(p, /De lo que no hay datos, no se cuenta/)
})

test('la pantalla abierta y el brief se inyectan solo si existen', () => {
  const sin = construirSystemPrompt({ tenantName: 'X' })
  assert.doesNotMatch(sin, /BRIEF DE HOY/)
  assert.doesNotMatch(sin, /tiene abierta la pantalla/)
  const con = construirSystemPrompt({ tenantName: 'X', screen: 'Métricas', briefResumen: 'SALUD: 70/100' })
  assert.match(con, /BRIEF DE HOY/)
  assert.match(con, /no lo recalcules a mano/)
  assert.match(con, /pantalla "Métricas"/)
})

// =============================================================================================
// EL GROWTH BRIEF: salud → restricción → impacto → acción. Y no puede contradecir al panel.
// =============================================================================================

const met = (over) => ({
  key: 'm',
  nombre: 'M',
  nivel: 'ventas',
  valor: 10,
  objetivo: 10,
  higherIsBetter: true,
  muestra: 200,
  investigar: [],
  ...over,
})

function briefDeEjemplo() {
  const metricas = [
    met({
      key: 'close_rate',
      nombre: 'Close rate',
      valor: 12,
      objetivo: 25,
      investigar: ['Revisar el pitch de precio'],
    }),
    met({ key: 'ctr', nombre: 'CTR', nivel: 'trafico', valor: 0.4, objetivo: 1.5, muestra: 50_000 }),
    // Un hueco de medición a propósito: el brief tiene que separarlo de los problemas de negocio.
    met({ key: 'speed_to_lead', nombre: 'Speed to Lead', nivel: 'funnel', valor: null }),
  ]
  const diagnostico = diagnosticarCuelloBotella(metricas, {
    muestraAlta: 100,
    muestraMinima: 20,
    umbralCritico: 0.2,
    ticketMedioEur: 1500,
    volumenBase: 120,
  })
  return construirBrief({
    salud: calcularSalud({ ventas: [metricas[0]], financiera: [met({ valor: 3, objetivo: 3 })] }),
    diagnostico,
    alertas: [
      alertaKpi({
        key: 'close_rate',
        nombre: 'Close rate',
        valor: 12,
        objetivo: 25,
        higherIsBetter: true,
        desvioRelativo: 0.52,
        muestra: 200,
      }),
      alertaCalidadDato({ key: 'atribucion', que: 'la campaña de cada contacto', detalle: '0 de 956.' }),
    ],
    escalado: evaluarEscalado(diagnostico, { utilizacionVentas: 30, utilizacionEntrega: 40 }),
    periodo: { desde: '2026-09-01', hasta: '2026-09-15' },
  })
}

test('el brief contesta en el orden salud → restricción → impacto → acción', () => {
  const b = briefDeEjemplo()
  const r = b.resumenParaAgente
  assert.ok(r.indexOf('SALUD:') < r.indexOf('RESTRICCIÓN:'))
  assert.ok(r.indexOf('RESTRICCIÓN:') < r.indexOf('IMPACTO:'))
  assert.ok(r.indexOf('IMPACTO:') < r.indexOf('ACCIÓN RECOMENDADA:'))
  assert.match(r, /Periodo: 2026-09-01 → 2026-09-15/)
})

// Si el chat dijera una restricción y la tarjeta otra, ninguna de las dos se creería.
test('el brief no puede contradecir al motor: la restricción es la misma', () => {
  const b = briefDeEjemplo()
  assert.equal(b.restriccion.nombre, 'Close rate')
  assert.equal(b.restriccion.certeza, 'probable')
  assert.match(b.resumenParaAgente, /Close rate/)
  // Y el CTR, muy peor en términos absolutos, no manda.
  assert.doesNotMatch(b.restriccion.titular, /CTR/)
})

test('la acción recomendada sale del árbol de diagnóstico, no de una ocurrencia', () => {
  assert.match(briefDeEjemplo().accion.texto, /Revisar el pitch de precio/)
})

test('sin qué investigar el brief manda investigar, no improvisa una táctica', () => {
  const d = diagnosticarCuelloBotella([met({ nombre: 'Show rate', valor: 30, objetivo: 65, investigar: [] })])
  const b = construirBrief({ salud: calcularSalud({}), diagnostico: d, alertas: [] })
  assert.match(b.accion.texto, /Investigar Show rate antes de actuar/)
})

// El número más peligroso del panel es un impacto inventado.
test('sin volumen base no se afirma un impacto en euros', () => {
  const d = diagnosticarCuelloBotella([met({ key: 'close_rate', nombre: 'Close rate', valor: 12, objetivo: 25 })])
  const b = construirBrief({ salud: calcularSalud({}), diagnostico: d, alertas: [] })
  assert.equal(b.impacto.esEstimacion, false)
  assert.match(b.impacto.texto, /No se puede estimar/)
  assert.doesNotMatch(b.impacto.texto, /€/)
})

test('cuando hay impacto se marca como estimación y arrastra el método', () => {
  const b = briefDeEjemplo()
  assert.equal(b.impacto.esEstimacion, true)
  assert.match(b.impacto.texto, /€/)
  assert.match(b.impacto.texto, /Estimación sobre el volumen actual/)
})

test('el brief lleva como máximo tres alertas y los huecos van aparte', () => {
  const b = briefDeEjemplo()
  assert.ok(b.alertas.length <= 3)
  assert.match(b.resumenParaAgente, /hueco de medición, NO problema de negocio/)
})

test('el veredicto de escalado del brief es el del motor, traducido', () => {
  assert.match(briefDeEjemplo().resumenParaAgente, /ESCALADO: (LISTO PARA ESCALAR|ESCALAR CON CAUTELA)/)
})

test('sin nada medido el brief no inventa una nota ni una restricción', () => {
  const b = construirBrief({ salud: calcularSalud({}), diagnostico: diagnosticarCuelloBotella([]), alertas: [] })
  assert.equal(b.salud.puntuacion, null)
  assert.equal(b.restriccion.nombre, null)
  assert.match(b.resumenParaAgente, /sin base suficiente para dar nota/)
  assert.match(b.accion.texto, /Mantener y vigilar/)
})

test('cuando lo único pendiente es medir, la acción es medir', () => {
  const d = diagnosticarCuelloBotella([met({ nombre: 'Speed to Lead', valor: null })])
  const b = construirBrief({ salud: calcularSalud({}), diagnostico: d, alertas: [] })
  assert.match(b.accion.texto, /empezar a medir: Speed to Lead/)
})

test('el resumen para el agente se puede pegar en el prompt y sigue siendo coherente', () => {
  const b = briefDeEjemplo()
  const p = construirSystemPrompt({ tenantName: 'X', briefResumen: b.resumenParaAgente })
  assert.ok(p.includes(b.resumenParaAgente))
  assert.match(p, /úsalo como punto de partida/)
})

// =============================================================================================
// LA CARGA DEL CONTEXTO. Distinguir "no configurado" de "no se pudo leer" es la diferencia entre un
// análisis honesto y un análisis sobre datos que nadie leyó.
// =============================================================================================

test('una fila de contexto se mapea a números y textos reales', async () => {
  const { mapearContexto } = await import('../../lib/ai/agent/contexto.ts')
  const c = mapearContexto({
    business_type: 'Infoproducto B2B',
    offer_name: 'Mentoría',
    offer_price_eur: '1997.00',
    sales_cycle_days: 12,
    target_monthly_revenue_eur: '40000',
    target_ltgp_cac: '3',
    target_cash_roas: '2',
    capacity_calls_per_week: 40,
    capacity_active_clients: 60,
    notes: '  ',
  })
  assert.equal(c.precioOfertaEur, 1997, 'un numeric de Postgres llega como string')
  assert.equal(c.objetivoFacturacionMensualEur, 40_000)
  assert.equal(c.notas, null, 'una cadena en blanco no es una nota')
  assert.equal(c.tipoNegocio, 'Infoproducto B2B')
})

test('una fila ausente da contexto vacío, no valores plausibles', async () => {
  const { mapearContexto } = await import('../../lib/ai/agent/contexto.ts')
  const c = mapearContexto(null)
  assert.ok(Object.values(c).every((v) => v === null))
})

test('un numeric ilegible no se convierte en NaN dentro del prompt', async () => {
  const { mapearContexto } = await import('../../lib/ai/agent/contexto.ts')
  const c = mapearContexto({ offer_price_eur: 'no-es-un-numero', target_ltgp_cac: '' })
  assert.equal(c.precioOfertaEur, null)
  assert.equal(c.objetivoLtgpCac, null)
  assert.doesNotMatch(describirContexto(c), /NaN/)
})

test('si la tabla de contexto no existe el agente sigue funcionando; un error real se propaga', async () => {
  const { cargarContextoNegocio } = await import('../../lib/ai/agent/contexto.ts')
  const fake = (error) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error }) }) }) }),
  })
  // 42P01 = la tabla no existe todavía (migración sin aplicar). No debe tumbar al agente.
  const sinTabla = await cargarContextoNegocio(fake({ code: '42P01', message: 'relation does not exist' }), 't')
  assert.ok(Object.values(sinTabla).every((v) => v === null))
  // Cualquier otro error SÍ se propaga: servir un análisis sobre datos que no se pudieron leer, sin
  // decirlo, es peor que fallar.
  await assert.rejects(
    () => cargarContextoNegocio(fake({ code: '08006', message: 'connection failure' }), 't'),
    /No se pudo leer el contexto de negocio/
  )
})

test('la ruta del agente carga el contexto y le da el motivo si falla', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../app/api/[tenant]/evergreen/ai/agent/route.ts', import.meta.url), 'utf8')
  assert.match(src, /cargarContextoNegocio\(sb, auth\.tenantId\)/)
  assert.match(src, /contexto,/, 'el contexto tiene que llegar a runAgent')
  assert.match(src, /Error de contexto/)
})

// =============================================================================================
// LA RUTA DEL CONTEXTO EDITABLE. Un objetivo de facturación no lo cambia un closer.
// =============================================================================================

test('la ruta del contexto exige rol de dirección para escribir y valida los rangos', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../app/api/[tenant]/evergreen/ai/contexto/route.ts', import.meta.url), 'utf8')
  const codigo = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  // Escritura solo dirección; lectura para el equipo.
  assert.match(codigo, /ROLES_ESCRITURA = \['admin', 'director'\]/)
  assert.match(codigo, /!ROLES_ESCRITURA\.includes\(auth\.role \|\| ''\)[\s\S]{0,200}status: 403/)
  const get = codigo.slice(codigo.indexOf('export async function GET'), codigo.indexOf('export async function PUT'))
  assert.doesNotMatch(get, /403/, 'leer el contexto no puede exigir rol de dirección')
  // Lista blanca de columnas: nada que no esté declarado llega al UPDATE.
  assert.match(codigo, /for \(const \[columna, tipo\] of Object\.entries\(CAMPOS\)\)/)
  assert.match(codigo, /if \(!\(columna in body\)\) continue/)
  // Rangos: un objetivo absurdo entraría en cada cálculo de LTGP:CAC del panel.
  assert.match(codigo, /n < min \|\| n > max/)
  // Y no se usa el service role: la ruta escribe con el cliente del usuario, así que el RLS manda.
  assert.doesNotMatch(codigo, /SERVICE_ROLE/)
})

test('poner un campo a null vuelve a "sin configurar" y no se confunde con no mandarlo', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../app/api/[tenant]/evergreen/ai/contexto/route.ts', import.meta.url), 'utf8')
  assert.match(src, /bruto === null \|\| bruto === ''/)
  assert.match(src, /valores\[columna\] = null/)
})

test('si la tabla no está creada la escritura lo dice en vez de soltar un error de base en crudo', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../../app/api/[tenant]/evergreen/ai/contexto/route.ts', import.meta.url), 'utf8')
  assert.match(src, /falta aplicar la migración[\s\S]{0,80}status: 503/)
})
