import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

// ---------------------------------------------------------------------------------------------
// Entrar en una sección tiene que responder "¿qué está pasando y dónde está el problema?", no
// abrir una tabla de filas ni una pantalla de configuración. La operativa viene después, a un clic.
// ---------------------------------------------------------------------------------------------

const RAICES = [
  ['app/[tenant]/crm/page.tsx', '/crm/agendas'],
  ['app/[tenant]/ventas/page.tsx', '/analitica/embudo'],
  ['app/[tenant]/marketing/adquisicion/page.tsx', '/marketing/adquisicion/campanas'],
  ['app/[tenant]/producto/page.tsx', '/students'],
  ['app/[tenant]/finanzas/page.tsx', '/finanzas/analitica/resumen'],
]

test('cada sección tiene raíz propia y abre en su vista de trabajo acordada', () => {
  for (const [ruta, destino] of RAICES) {
    const src = read(ruta)
    assert.match(src, new RegExp(`redirect\\(\`/\\$\\{tenant\\}${destino.replace(/\//g, '\\/')}\``), `${ruta}`)
  }
})

// La redirección va en SERVIDOR. Con useEffect + router.replace hay que montar un componente cliente
// que pinta `null` —instante de pantalla en blanco—, el navegador nunca recibe un redirect HTTP, y
// queda una entrada muerta en el historial: el botón "atrás" vuelve a la raíz y rebota otra vez.
// Ya estaba documentado en /crm; ventas y marketing/adquisicion seguían con la versión cliente.
test('ninguna raíz de sección redirige desde el cliente', () => {
  for (const [ruta] of RAICES) {
    const src = read(ruta)
    // Sobre el código SIN comentarios: /crm/page.tsx explica en su cabecera por qué el useEffect era
    // incorrecto, y buscar el texto a secas daría por roto justo al archivo que documenta la regla.
    const codigo = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.match(src, /^import \{ redirect \} from 'next\/navigation'/m, `${ruta}: debe usar redirect() de servidor`)
    assert.doesNotMatch(codigo, /'use client'/, `${ruta}: no puede ser componente cliente`)
    assert.doesNotMatch(codigo, /useEffect|router\.replace/, `${ruta}: no puede redirigir con un efecto`)
  }
})

// Renombrar el hub analítico no puede llevarse por delante la vista operativa: son dos cosas
// distintas y se usan para cosas distintas.
test('el hub analítico se llama Métricas y KPIs sin absorber la vista operativa de Campañas', () => {
  const nav = read('lib/nav.ts')
  const marketing = nav.slice(nav.indexOf("dept: 'marketing'"), nav.indexOf("dept: 'producto'"))
  assert.match(marketing, /label: 'Métricas y KPIs'/)
  assert.match(marketing, /href: '\/marketing\/adquisicion\/campanas'/)
})

test('Marketing abre en Campañas y la muestra antes que Atribución', () => {
  const nav = read('lib/nav.ts')
  const marketing = nav.slice(nav.indexOf("dept: 'marketing'"), nav.indexOf("dept: 'producto'"))
  assert.match(marketing, /href: '\/marketing\/adquisicion\/campanas'/)
  assert.ok(marketing.indexOf("label: 'Campañas'") < marketing.indexOf("label: 'Atribución'"))
})

// En Ventas, lo analítico va ANTES que lo operativo en el menú, no solo en la redirección: si el
// orden del menú contradijera al destino de la sección, la mitad de la gente entraría por el sitio
// que el rediseño quería dejar en segundo plano.
test('en Ventas el bloque de métricas aparece antes que el operativo', () => {
  const nav = read('lib/nav.ts')
  const ventas = nav.slice(nav.indexOf("dept: 'ventas'"), nav.indexOf("dept: 'marketing'"))
  const metricas = ventas.indexOf("label: 'Métricas y KPIs'")
  const operativa = ventas.indexOf("label: 'Ventas & Cobros'")
  assert.ok(metricas > -1 && operativa > -1, 'faltan los bloques de Ventas en el menú')
  assert.ok(metricas < operativa, 'el bloque operativo aparece antes que el de métricas')
})

// El CRM abre en la agenda, que es lo que el equipo mira cada mañana. Contactos es una consulta, no
// el punto de partida del día.
test('el CRM sigue abriendo en Agendas y Contactos no es el destino por defecto', () => {
  const src = read('app/[tenant]/crm/page.tsx')
  assert.match(src, /\/crm\/agendas/)
  assert.doesNotMatch(src, /redirect\(`\/\$\{tenant\}\/crm\/contactos`\)/)
})

// El pipeline comercial NO es una pantalla nueva: es la vista kanban que ya existía en Seguimiento,
// sobre appointments.followup_stage. El menú entra directo a ella. Si alguien construyera un segundo
// pipeline, este test lo caza: el enlace tiene que seguir apuntando a la pantalla que ya existe.
test('el Pipeline del CRM reutiliza el kanban de Seguimiento y va detrás de Agendas', () => {
  const nav = read('lib/nav.ts')
  const crm = nav.slice(nav.indexOf("label: 'CRM'"), nav.indexOf("label: 'Ventas & Cobros'"))
  assert.match(crm, /label: 'Pipeline',\n\s+href: '\/crm\/seguimiento\?view=kanban'/)

  const agendas = crm.indexOf("label: 'Agendas'")
  const pipeline = crm.indexOf("label: 'Pipeline'")
  const contactos = crm.indexOf("label: 'Contactos'")
  assert.ok(agendas > -1 && pipeline > -1 && contactos > -1, 'faltan entradas del CRM')
  assert.ok(agendas < pipeline, 'Agendas debe ser la primera vista del CRM')
  assert.ok(pipeline < contactos, 'Pipeline debe ir antes que Contactos')
})

// Y la pantalla tiene que respetar el ?view=kanban del enlace: si no, el menú prometería el pipeline
// y entregaría la tabla.
test('Seguimiento abre en la vista que pide la URL', () => {
  const src = read('app/[tenant]/crm/seguimiento/page.tsx')
  assert.match(src, /readEnum\(searchParams\.get\('view'\), \['tabla', 'kanban'\] as const, 'tabla'\)/)
})
