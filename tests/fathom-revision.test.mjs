import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
// Los comentarios explican justo lo que estos tests prohíben, así que se quitan antes de buscar:
// si no, un test pasaría o fallaría por el texto de una explicación.
const sinComentarios = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const ROUTE = 'app/api/[tenant]/evergreen/fathom-revision/route.ts'
const PAGE = 'app/[tenant]/crm/fathom-revision/page.tsx'

// La cola existe precisamente porque el matcher se NIEGA a elegir cuando hay empate. Si la ruta que
// la resuelve eligiera sola (el primer candidato, el más cercano, el último…) volveríamos al fallo
// original por la puerta de atrás, y encima con aspecto de decisión humana.
test('resolver exige una cita elegida: nunca se elige sola', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /if \(!body\.appointmentId\)/, 'la ruta no exige appointmentId para asignar')
  assert.doesNotMatch(route, /candidate_appointment_ids\[0\]/, 'la ruta coge el primer candidato por su cuenta')
  assert.doesNotMatch(route, /decideMatch/, 'la resolución manual no debe volver a pasar por el matcher')

  const page = sinComentarios(read(PAGE))
  // Ni la pantalla debe preseleccionar: un radio marcado por defecto es una decisión tomada por el
  // sistema que la persona puede confirmar sin mirar.
  assert.doesNotMatch(page, /useState<Record<string, string>>\(\{\s*\[/, 'la pantalla preselecciona una candidata')
  assert.match(
    page,
    /disabled=\{working === item\.id \|\| !choice\[item\.id\]\}/,
    'el botón de asignar no exige elección'
  )
})

// El tenant sale de la URL y lo valida requireTenant. Si saliera del body, cualquiera podría
// resolver casos de otra subcuenta cambiando un campo del JSON.
test('el tenant sale de los params y nunca del body', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /const \{ tenant \} = await params/)
  assert.doesNotMatch(route, /body\.(tenant|tenantId|tenant_id)/)
  // Toda consulta a las dos tablas va filtrada por el tenant de la sesión, porque el cliente es
  // service_role y no pasa por RLS.
  const consultas = [...route.matchAll(/\.from\('(fathom_match_review|appointments)'\)/g)]
  assert.ok(consultas.length >= 5, 'no se han encontrado las consultas esperadas')
  const filtros = [...route.matchAll(/\.eq\('tenant_id', (?:tenantId|session\.tenantId)\)/g)]
  assert.ok(
    filtros.length >= consultas.length,
    `hay ${consultas.length} consultas a tablas con tenant_id y solo ${filtros.length} filtros por tenant`
  )
})

// Escribir una transcripción en una cita es una decisión sobre datos: mismo criterio que la política
// de escritura de la tabla. Leer la cola sí es para todo el equipo.
test('solo admin o dirección pueden resolver; leer es de todo el equipo', () => {
  const route = sinComentarios(read(ROUTE))
  const post = route.slice(route.indexOf('export async function POST'))
  assert.match(post, /role !== 'admin' && session\.role !== 'director'/, 'el POST no comprueba el rol')
  assert.match(post, /status: 403/)
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'))
  assert.doesNotMatch(get, /status: 403/, 'el GET no debería exigir rol de admin')
})

// Supabase no da error cuando un UPDATE afecta a 0 filas: sin .select() daríamos por escrito lo que
// RLS, un id obsoleto o una condición de carrera dejaron sin tocar.
test('toda escritura comprueba las filas afectadas', () => {
  const route = sinComentarios(read(ROUTE))
  const updates = [...route.matchAll(/\.update\(/g)].length
  const selects = [...route.matchAll(/\.select\('id'\)/g)].length
  assert.ok(selects >= updates, `hay ${updates} updates y solo ${selects} comprobaciones de filas`)
  assert.match(route, /updated\.length === 0/, 'no se comprueba el resultado del update de la cita')
  // Cerrar el caso solo si sigue pendiente: dos personas resolviendo a la vez no deben pisarse.
  assert.match(route, /\.eq\('status', 'pendiente'\)/)
})

// El fallo que creó esta cola era escribir la misma llamada en N citas. Resolver a mano no puede
// reproducirlo, ni pisar la transcripción de otra llamada ya importada en la cita elegida.
test('resolver no puede duplicar una llamada ni pisar otra', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /cita_ocupada/, 'no se comprueba que la cita ya tenga otra llamada')
  assert.match(route, /llamada_ya_atribuida/, 'no se comprueba que la llamada esté ya en otra cita')
  assert.match(route, /\.neq\('id', appointmentId\)/, 'la comprobación de duplicado no excluye la propia cita')
})

// Si la reunión no aparece en las páginas recorridas de Fathom, no se sabe si tiene transcripción o
// no. Decir "sin transcripción" sería afirmar algo no comprobado: la misma regla que "un hueco no es
// un cero" aplicada a un texto.
test('no se afirma que no hay transcripción cuando solo es que no se encontró', () => {
  const route = sinComentarios(read(ROUTE))
  assert.match(route, /no_encontrada_en_fathom/)
  assert.match(route, /la_reunion_no_tiene/)
  assert.match(route, /transcript_status: 'pendiente'/, 'la cita debería quedar pendiente de transcribir')
  const page = read(PAGE)
  assert.match(page, /no apareció en las últimas/, 'la pantalla no explica el caso de "no encontrada"')
})

// El sync salta los casos que ya están en la cola para no pisar la decisión humana. Por eso la
// transcripción tiene que traerla la resolución: si no, no llegaría nunca.
test('la resolución trae la transcripción porque el sync ya no volverá a por ella', () => {
  assert.match(read(ROUTE), /findMeetingById/)
  const sync = read('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts')
  assert.match(sync, /ya_en_revision\+\+/, 'el sync ya no salta los casos en revisión')
})

// El formato de la transcripción y el acceso a la API viven en un solo módulo: antes estaban inline
// en el sync, y la resolución habría acabado con una segunda versión divergiendo.
test('el acceso a Fathom está en un único módulo compartido', () => {
  const helper = read('lib/fathom/meetings.ts')
  assert.match(helper, /api\.fathom\.ai\/external\/v1\/meetings/)
  const sync = read('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts')
  assert.doesNotMatch(
    sinComentarios(sync),
    /api\.fathom\.ai/,
    'el sync vuelve a construir la URL de Fathom por su cuenta'
  )
  assert.match(sync, /from '@\/lib\/fathom\/meetings'/)
})

test('la ruta y la pantalla están registradas en el menú y en los permisos', () => {
  assert.match(read('lib/nav.ts'), /href: '\/crm\/fathom-revision'/)
  assert.match(read('lib/auth/permissions.ts'), /href: '\/crm\/fathom-revision'/)
})
