import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { countDuplicateKeys, countDuplicateValues, deriveSourceStatus } from '../lib/data-health.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

// Configuración tiene UN solo nivel de navegación: la rejilla de tarjetas. La barra de pestañas
// (General / Integraciones / Data Health) que se superponía a la rejilla ya no existe.
test('Configuración es una sola rejilla, sin pestañas por encima', () => {
  const general = read('app/[tenant]/settings/page.tsx')
  assert.equal(existsSync(join(root, 'components/settings/SettingsNav.tsx')), false)
  assert.doesNotMatch(general, /SettingsNav/)
  assert.doesNotMatch(general, /searchParams|tab=data-health|DataHealthPanel/)
  // Integraciones, Data Health y Auditoría son tarjetas más de la rejilla.
  for (const href of ["'/settings/integraciones'", "'/settings/data-health'", "'/audit'"]) {
    assert.match(general, new RegExp(`href: ${href}`), `falta la tarjeta ${href}`)
  }
  // Data Health es la única visible sin permisos de gestión, como filtraba antes la barra.
  assert.match(general, /manageOnly: false/)
  assert.match(general, /canManage === true \|\| card\.manageOnly === false/)
})

// El contexto de negocio y los assets de marca no son una integración: no hay credencial ni
// conexión que probar. Viven en Datos de empresa, pero su persistencia sigue siendo la misma.
test('el bloque de negocio salió de Integraciones sin migrar datos', () => {
  const catalog = read('lib/integrations-catalog.ts')
  const integraciones = read('app/[tenant]/settings/integraciones/page.tsx')
  const empresa = read('app/[tenant]/settings/empresa/page.tsx')
  assert.match(catalog, /surface: 'empresa'/, 'el grupo negocio no está marcado como fuera de Integraciones')
  assert.match(catalog, /IG_BUSINESS_CONTEXT/, 'las claves deben seguir en el catálogo para poder guardarse')
  assert.match(catalog, /IG_BRAND_ASSETS/)
  assert.match(catalog, /INTEGRATION_ONLY_GROUPS/)
  assert.doesNotMatch(integraciones, /IG_BRAND_ASSETS|brandAssets|'negocio'/)
  assert.match(empresa, /BusinessContextCard/)
})

// Auditoría es la única trazabilidad de quién tocó un dato financiero: se mueve, no se borra.
test('Auditoría sigue existiendo, dentro de Configuración y no en primer nivel', () => {
  const nav = read('lib/nav.ts')
  assert.equal(existsSync(join(root, 'app/[tenant]/audit/page.tsx')), true, 'la pantalla de auditoría ha desaparecido')
  const sistema = nav.slice(nav.indexOf("dept: 'sistema'"))
  const config = sistema.slice(sistema.indexOf("label: 'Configuración'"))
  assert.match(config, /label: 'Auditoría'/, 'Auditoría no está entre los hijos de Configuración')
  // Y ya no cuelga del primer nivel, al lado de Actividad.
  const beforeConfig = sistema.slice(0, sistema.indexOf("label: 'Configuración'"))
  assert.doesNotMatch(beforeConfig, /label: 'Auditoría'/)
})

test('Integraciones usa tarjetas, panel accesible y estados no engañosos', () => {
  const page = read('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(page, /<Sheet/)
  assert.match(page, /Cómo se conecta/)
  assert.match(page, /datos históricos importados/)

  // El estado ya NO se deduce en la pantalla a partir de "¿existe la credencial?": lo calcula el
  // servidor comprobando contra la API de verdad. Antes había aquí un `verification` local que solo
  // existía si habías pulsado probar en esa visita, así que al recargar todo volvía a "configurada".
  assert.match(page, /health\[g\.id\]/, 'la tarjeta no lee el estado calculado por el servidor')
  assert.doesNotMatch(page, /const \[verification/, 'volvió el estado local que se perdía al recargar')

  // Las tres luces, y cada una con texto además del color: el color solo no vale para quien no
  // distingue verde de rojo.
  for (const estado of ['conectada', 'sin_configurar', 'error']) {
    assert.match(page, new RegExp(`${estado}:`), `la pantalla no contempla el estado ${estado}`)
  }
  assert.match(page, /h\.detail/, 'no se pinta el motivo del estado')
  assert.match(page, /h\.fix/, 'no se pinta cómo arreglarlo')
})

// DeepSeek dejó de ser una tarjeta aparte: es UN MOTOR MÁS dentro del módulo de IA. Tenerlo separado
// obligaba a configurar la inteligencia artificial en dos sitios y escondía que ambos hacen el mismo
// trabajo; además, el selector de modelos quedaba en un grupo y el campo en otro, así que no se
// mostraba nunca.
test('DeepSeek se configura DENTRO del módulo de IA, como un motor más', () => {
  const catalog = read('lib/integrations-catalog.ts')
  const route = read('app/api/[tenant]/evergreen/settings/integraciones/route.ts')
  const page = read('app/[tenant]/settings/integraciones/page.tsx')

  assert.ok(!/id: 'deepseek'/.test(catalog), 'DeepSeek no debe ser un grupo propio')
  assert.ok(!/group === 'deepseek'/.test(route), 'su prueba de conexión va con la del grupo de IA')
  assert.ok(!/^ {2}deepseek: \{/m.test(page), 'no debe quedar su tarjeta suelta en la documentación')

  // Sus campos viven en el grupo `ai`, y siguen siendo secreto / no secreto como corresponde.
  const grupoAi = catalog.slice(catalog.indexOf("id: 'ai'"), catalog.indexOf("id: 'youtube'"))
  assert.match(grupoAi, /key: 'DEEPSEEK_API_KEY'[\s\S]*?secret: true/)
  assert.match(grupoAi, /key: 'DEEPSEEK_MODEL'[\s\S]*?secret: false/)
  assert.match(grupoAi, /ANTHROPIC_API_KEY/)

  // DeepSeek y Anthropic son alternativas reales: no se puede exigir Anthropic cuando DeepSeek es
  // el motor elegido, ni Groq (que solo aporta transcripción) para usar el agente de texto.
  assert.match(grupoAi, /requiredAny: \['DEEPSEEK_API_KEY', 'ANTHROPIC_API_KEY'\]/)
  assert.ok(!/required: \['ANTHROPIC_API_KEY', 'GROQ_API_KEY'\]/.test(grupoAi))
  assert.match(route, /Configura al menos un motor de texto: DeepSeek o Anthropic/)
})

test('la asistencia vive en Notificaciones y el widget positivo ya no se sirve', () => {
  const header = read('components/os/Header.tsx')
  const dashboard = read('app/[tenant]/dashboard/page.tsx')
  assert.match(header, /pendiente[\s\S]*de asistencia/)
  assert.match(header, /markAttendance/)
  assert.doesNotMatch(dashboard, /PendingAttendanceAlert|PositiveNoteWidget/)
  assert.equal(existsSync(join(root, 'components/os/PositiveNoteWidget.tsx')), false)
  assert.equal(existsSync(join(root, 'app/api/[tenant]/evergreen/positive-notes/route.ts')), false)
})

test('deduplicación normaliza identidades y solo cuenta excedentes reales', () => {
  assert.equal(countDuplicateValues([' A@EXAMPLE.com ', 'a@example.com', null, 'b@example.com']), 1)
  assert.equal(countDuplicateValues(['+34 600-100-200', '+34600100200']), 1)
  assert.equal(countDuplicateKeys(['calendly:1', 'calendly:1', 'ghl:1', null]), 1)
})

test('una credencial no equivale a una integración operativa', () => {
  assert.equal(deriveSourceStatus(false, 0), 'not_configured')
  assert.equal(deriveSourceStatus(true, 0), 'needs_attention')
  assert.equal(deriveSourceStatus(true, 49), 'connected')
})

// Fase F: la agenda es el destino por defecto del CRM, y la redirección es de servidor.
test('/crm redirige a la agenda en servidor, sin parpadeo de cliente', () => {
  const page = read('app/[tenant]/crm/page.tsx')
  assert.match(page, /redirect\(`\/\$\{tenant\}\/crm\/agendas`\)/)
  // Un useEffect con router.replace obliga a montar un componente cliente que pinta null: hay un
  // instante en blanco y el navegador no recibe un redirect HTTP de verdad.
  // Se comprueba sobre el CÓDIGO, no sobre los comentarios: el propio archivo explica en prosa qué
  // sustituyó, y buscar esas palabras en crudo daría un falso positivo.
  const code = page.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(code, /'use client'|useEffect|router\.replace/)
  assert.match(read('lib/nav.ts'), /label: 'CRM',\s*\n\s*href: '\/crm\/agendas'/)
})

// El payload crudo del webhook es un volcado interno: ids externos, campos técnicos y datos del
// lead sin normalizar. Antes se pintaba abierto para cualquiera que pudiera ver la cita.
test('el payload crudo de una cita está plegado y restringido', () => {
  const detail = read('components/appointments/AppointmentDetail.tsx')
  assert.match(detail, /canSeeRawPayload\?: boolean/)
  assert.match(detail, /canSeeRawPayload && appointment\.raw_payload/)
  assert.match(detail, /<details/, 'debe ir plegado, fuera del flujo normal de la ficha')
  // Y las respuestas legibles siguen visibles para todos: eso no se restringe.
  assert.match(detail, /qualificationEntries\.length > 0/)
  for (const caller of ['app/[tenant]/crm/agendas/page.tsx', 'app/[tenant]/crm/seguimiento/page.tsx']) {
    assert.match(read(caller), /canSeeRawPayload=\{isAdmin\}/, `${caller} no pasa la restricción`)
  }
})
