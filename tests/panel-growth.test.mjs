import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const PANEL = 'components/metrics/PanelGrowth.tsx'
const PAGINA = 'app/[tenant]/analitica/page.tsx'

// ---------------------------------------------------------------------------------------------
// NI UN NÚMERO SE RECALCULA EN LA PANTALLA. Si esta vista hiciera su propia aritmética, el panel y el
// agente podrían decir cosas distintas del mismo negocio, y entonces no se cree a ninguno de los dos.
// ---------------------------------------------------------------------------------------------

test('el panel solo pinta lo que le da la ruta', () => {
  const codigo = sinComentarios(leer(PANEL))
  assert.match(codigo, /pedir<Respuesta>\(/)
  assert.match(codigo, /metricas\/brief/)
  // Nada de calcular ratios, porcentajes o diagnósticos aquí.
  assert.doesNotMatch(codigo, /diagnosticarCuelloBotella|calcularSalud|calcularAgregados/)
})

test('la restricción va primero, antes de las tarjetas', () => {
  const codigo = sinComentarios(leer(PANEL))
  const restriccion = codigo.indexOf('Restricción actual')
  const tarjetas = codigo.indexOf('<KpiCard')
  assert.ok(restriccion > -1 && restriccion < tarjetas, 'un panel que abre con veinte tarjetas no dirige a nada')
})

// ---------------------------------------------------------------------------------------------
// LA PANTALLA NO PUEDE COLGARSE: es la misma lección del layout.
// ---------------------------------------------------------------------------------------------

test('la carga tiene finally y cancelación al desmontar', () => {
  const codigo = sinComentarios(leer(PANEL))
  assert.match(codigo, /\} finally \{\s*setCargando\(false\)/)
  assert.match(codigo, /new AbortController\(\)/)
  assert.match(codigo, /return \(\) => ac\.abort\(\)/)
})

test('distingue sin permiso de error y ofrece reintento solo si sirve', () => {
  const codigo = sinComentarios(leer(PANEL))
  assert.match(codigo, /fallo\.tipo === 'permiso' \? 'sin_permiso' : 'error'/)
  assert.match(codigo, /fallo\.reintentable \?/)
  // Una cancelación por navegar no se enseña como error.
  assert.match(codigo, /if \(esFalloVisible\(res\)\) setFallo\(res\)/)
})

// ---------------------------------------------------------------------------------------------
// NO SE INVENTAN NÚMEROS, Y LOS HUECOS SE DICEN.
// ---------------------------------------------------------------------------------------------

test('el impacto se marca como estimación y no se rellena si no se pudo calcular', () => {
  const codigo = leer(PANEL)
  assert.match(codigo, /brief\.impacto\.texto/)
  assert.match(codigo, /Es una estimación, no un compromiso/)
})

test('los huecos se presentan como falta de medición, no como problema del negocio', () => {
  assert.match(leer(PANEL), /hueco de medición, no un problema del negocio/)
})

test('la salud enseña sus partes, su cobertura y su fiabilidad', () => {
  const codigo = leer(PANEL)
  assert.match(codigo, /salud\.subscores\.map/)
  assert.match(codigo, /Math\.round\(s\.cobertura \* 100\)/)
  assert.match(codigo, /fiabilidad \{s\.fiabilidad\}/)
  // Y sin nota, se dice "s/d" en vez de un 0.
  assert.match(codigo, /'s\/d'/)
})

test('se dice cuántas métricas tienen datos, para que la pantalla no parezca averiada', () => {
  const codigo = leer(PANEL)
  assert.match(codigo, /cobertura\.medidas\} de \{cobertura\.total\} con datos/)
})

// "Ver cálculo" es lo que hace que alguien se fíe de una cifra que no cuadra con su hoja de cálculo.
test('cada tarjeta puede abrir de dónde sale su número', () => {
  const codigo = sinComentarios(leer(PANEL))
  assert.match(codigo, /onDrilldown=\{\(\) => setVerCalculo\(m\.key\)\}/)
  assert.match(codigo, /Cómo se ha calculado/)
  assert.match(codigo, /filasLeidas/)
  assert.match(codigo, /muestra/)
})

// ---------------------------------------------------------------------------------------------
// LA PÁGINA. No es un dashboard paralelo: llena el índice de Analítica, que solo redirigía.
// ---------------------------------------------------------------------------------------------

test('el índice de Analítica ya no es una redirección vacía', () => {
  const codigo = sinComentarios(leer(PAGINA))
  assert.doesNotMatch(codigo, /router\.replace/)
  assert.match(codigo, /<PanelGrowth/)
})

test('los filtros de periodo son los mismos que en el resto de métricas', () => {
  const codigo = leer(PAGINA)
  for (const etiqueta of ['Hoy', '3 días', '7 días', 'Este mes', 'Trimestre', 'Año']) {
    assert.ok(codigo.includes(etiqueta), `falta el rango ${etiqueta}`)
  }
  // Accesible: el grupo se anuncia y el botón activo se declara.
  assert.match(codigo, /role="group"/)
  assert.match(codigo, /aria-pressed=\{rango === r\.id\}/)
})

test('el periodo se pasa a la ruta en vez de recalcularse en el panel', () => {
  assert.match(sinComentarios(leer(PAGINA)), /<PanelGrowth desde=\{desde\} hasta=\{hasta\} \/>/)
})

// ---------------------------------------------------------------------------------------------
// EL AGENTE NO ABRE CON UN CHAT VACÍO. Un cuadro de texto en blanco traslada a la persona el trabajo de
// saber qué preguntar, y el resultado es que no se usa.
// ---------------------------------------------------------------------------------------------

const CABECERA = 'components/ai/GrowthBriefCabecera.tsx'

test('la cabecera del agente enseña salud, restricción, impacto y acción', () => {
  const codigo = leer(CABECERA)
  assert.match(codigo, /Growth Brief/)
  for (const seccion of ['Salud', 'Restricción', 'Impacto', 'Acción recomendada']) {
    assert.ok(codigo.includes(seccion), `falta ${seccion}`)
  }
})

test('la cabecera pide el mismo brief que el panel, no uno propio', () => {
  const codigo = sinComentarios(leer(CABECERA))
  assert.match(codigo, /metricas\/brief/)
  assert.doesNotMatch(codigo, /diagnosticarCuelloBotella|calcularSalud/)
})

// Si el brief falla, el chat tiene que seguir sirviendo: es un extra, no un requisito.
test('si el brief no carga, la cabecera desaparece en vez de romper el chat', () => {
  const codigo = sinComentarios(leer(CABECERA))
  assert.match(codigo, /if \(!datos\) return null/)
  // Y no pinta un error: un aviso aquí convertiría un problema de métricas en una avería del agente.
  assert.doesNotMatch(codigo, /setError|alertaCalidadDato|EstadoPanel/)
})

test('el botón manda al agente el brief ya calculado, no una pregunta vaga', () => {
  const codigo = leer(CABECERA)
  assert.match(codigo, /brief\.resumenParaAgente/)
  assert.match(codigo, /qué mirar para saber si funcionó/)
})

test('el launcher monta la cabecera antes de las sugerencias', () => {
  const codigo = sinComentarios(leer('components/ai/AgentLauncher.tsx'))
  const cabecera = codigo.indexOf('<GrowthBriefCabecera')
  const sugerencias = codigo.indexOf('suggestionsFor(relPath)')
  assert.ok(cabecera > -1 && cabecera < sugerencias)
})

// El brief se le pasa al modelo, pero solo al empezar: repetir cuatro consultas en cada turno de una
// conversación larga es pagar latencia por algo que ya está en el contexto.
test('la ruta del agente le pasa el brief solo al arrancar la conversación', () => {
  const codigo = sinComentarios(leer('app/api/[tenant]/evergreen/ai/agent/route.ts'))
  assert.match(codigo, /if \(history\.length <= 2\)/)
  assert.match(codigo, /briefResumen,/)
  // Y si el brief falla, el agente responde igual usando sus herramientas.
  assert.match(codigo, /briefResumen = undefined/)
})

// ---------------------------------------------------------------------------------------------
// LAS AGENDAS ENSEÑAN LAS RESPUESTAS, NO EL PAYLOAD.
//
// La sección "Formulario / Cualificación" existía y NUNCA aparecía: leía `appointment.qualification`,
// que en producción está a 0 de 559. Las respuestas viven en `raw_payload` (473 de 559), así que quien
// llamaba tenía que desplegar el JSON crudo para ver lo que el lead había contestado.
// ---------------------------------------------------------------------------------------------

const DETALLE = 'components/appointments/AppointmentDetail.tsx'

test('el formulario cae a raw_payload cuando la columna estructurada está vacía', () => {
  const codigo = sinComentarios(leer(DETALLE))
  assert.match(codigo, /extraerRespuestas\(appointment\.raw_payload, appointment\.external_source\)/)
  assert.match(codigo, /qualificationEntries\.length > 0\s*\?\s*qualificationEntries\s*:\s*respuestasDelPayload/)
  // Y la sección se pinta con la lista combinada, no con la columna vacía.
  assert.match(codigo, /\{entradasFormulario\.length > 0 && \(/)
  assert.match(codigo, /entradasFormulario\.map\(/)
})

test('se enseña el veredicto de cualificación que cuenta el panel, con sus motivos', () => {
  const codigo = leer(DETALLE)
  assert.match(codigo, /Cualificación de marketing/)
  assert.match(codigo, /veredicto\.motivos\.map/)
  assert.match(codigo, /fiabilidad \{veredicto\.fiabilidad\}/)
})

// `null` no es "no cualificada": es que el formulario no da para decidirlo. Pintarlo como un "no"
// metería en las no cualificadas a todo el que simplemente no contestó.
test('sin datos suficientes no se declara "no cualificada"', () => {
  const codigo = leer(DETALLE)
  assert.match(codigo, /no se puede saber con lo que contestó/)
  assert.match(codigo, /veredicto\.cualificada === true[\s\S]{0,120}=== false/)
})

test('el payload crudo sigue plegado y solo para quien administra', () => {
  const codigo = sinComentarios(leer(DETALLE))
  assert.match(codigo, /canSeeRawPayload && appointment\.raw_payload/)
  assert.match(codigo, /<details/)
})
