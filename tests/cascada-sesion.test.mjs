import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// ---------------------------------------------------------------------------------------------
// LA CASCADA DE DATOS. 32 pantallas repetían `auth.getUser()` y 24 volvían a pedir `users` + `roles`,
// justo lo que el layout acababa de traer para decidir si dejarlas entrar. Eran dos viajes de red EN
// SERIE por pantalla, antes de pedir el dato que la persona ha venido a ver.
// ---------------------------------------------------------------------------------------------

test('el layout publica la sesión que ya resolvió', () => {
  const codigo = sinComentarios(leer('app/[tenant]/layout.tsx'))
  assert.match(codigo, /const sesion = useMemo\(/)
  assert.match(codigo, /userId: user\.id, user, rol: user\.roles\?\.key \?\? null, isSuperAdmin/)
  // Los dos TenantProvider (ruta pública y panel) la pasan: si solo uno, useSesion() daría null a medias.
  assert.equal((codigo.match(/sesion=\{sesion\}/g) || []).length, 2)
})

// SIN useMemo ESTO ES UN BUG: las pantallas ponen `sesion` en las dependencias de su efecto de carga, y
// un objeto nuevo en cada render del layout sería una referencia nueva → recarga en bucle.
test('la sesión está memorizada, o las pantallas recargarían en bucle', () => {
  const codigo = sinComentarios(leer('app/[tenant]/layout.tsx'))
  assert.match(codigo, /useMemo\(\s*\(\) => \(user \?[\s\S]{0,200}\[user, isSuperAdmin\]\s*\)/)
  assert.match(leer('app/[tenant]/layout.tsx'), /import \{ useState, useEffect, useMemo \} from 'react'/)
})

test('useSesion existe y no miente en las rutas públicas', () => {
  const src = leer('lib/tenant-context.tsx')
  assert.match(src, /export function useSesion\(\): SesionTenant \| null/)
  // Devuelve null donde no hay sesión (login, recover) en vez de lanzar: esas páginas se renderizan
  // a propósito sin sesión.
  assert.match(src, /return ctx\.sesion/)
  assert.match(src, /throw new Error\('useSesion\(\) called outside <TenantProvider>/)
})

test('el dashboard ya no repite auth.getUser() ni relee users dos veces', () => {
  const codigo = sinComentarios(leer('app/[tenant]/dashboard/page.tsx'))
  assert.doesNotMatch(codigo, /auth\.getUser\(\)/)
  // Eran DOS consultas a `users` para la misma fila, separadas por si las columnas del fijo no existían.
  assert.equal((codigo.match(/\.from\('users'\)\s*\n?\s*\.select\('full_name/g) || []).length, 0)
  assert.match(codigo, /const sesion = useSesion\(\)/)
  assert.match(codigo, /if \(!sesion \|\| !mounted\) return/)
  // Y sigue leyendo las columnas del fijo, que vienen del select('*') del layout.
  assert.match(codigo, /fijo_unlock_type/)
  assert.match(codigo, /base_salary/)
})

test('agendas ya no encadena getUser + users antes de pedir las agendas', () => {
  const codigo = sinComentarios(leer('app/[tenant]/crm/agendas/page.tsx'))
  assert.doesNotMatch(codigo, /auth\.getUser\(\)/)
  // El Promise.all de UN solo elemento no paralelizaba nada; ya no está.
  assert.doesNotMatch(codigo, /Promise\.all\(\[supabase\.auth\.getUser\(\)\]\)/)
  assert.match(codigo, /const sesion = useSesion\(\)/)
  // El filtro por rol sigue aplicándose: quitarlo habría convertido una mejora de rendimiento en una
  // fuga de agendas de otros closers.
  assert.match(codigo, /if \(userId && role && !isLeadership\(role as AppRole\) && scope !== 'team'\)/)
  assert.match(codigo, /appointmentsQuery\.eq\('closer_id', userId\)/)
  assert.match(codigo, /appointmentsQuery\.eq\('setter_id', userId\)/)
})

// El scoping por data_scope es una regla de acceso, no una preferencia: si se perdiera al refactorizar,
// un closer vería las agendas de todos.
test('el scoping propio del dashboard se mantiene', () => {
  const codigo = sinComentarios(leer('app/[tenant]/dashboard/page.tsx'))
  assert.match(codigo, /if \(!isLeadership\(rk\) && userData\.data_scope === 'own'\)/)
  assert.match(codigo, /setSelfScoped\(true\)/)
  assert.match(codigo, /setMember\(sesion\.userId\)/)
})

// ---------------------------------------------------------------------------------------------
// LAS PANTALLAS MIGRADAS. Cada una tenía el mismo par en serie —`auth.getUser()` y después releer su
// propia fila de `users`— antes de poder pedir el dato que la persona venía a ver.
// ---------------------------------------------------------------------------------------------

const MIGRADAS = [
  'app/[tenant]/dashboard/page.tsx',
  'app/[tenant]/crm/agendas/page.tsx',
  'app/[tenant]/crm/seguimiento/page.tsx',
  'app/[tenant]/comisiones/page.tsx',
  'app/[tenant]/settings/page.tsx',
  'app/[tenant]/settings/socios/page.tsx',
  'app/[tenant]/settings/commission-rules/page.tsx',
  'app/[tenant]/marketing/afiliados/afiliados/page.tsx',
  'app/[tenant]/marketing/afiliados/campanas/page.tsx',
  'app/[tenant]/recursos/enlaces/page.tsx',
  'components/kpi/KPIReportPanel.tsx',
  'components/settings/AiEnginePanel.tsx',
]

const CIERRE_PANTALLAS = [
  'app/[tenant]/instagram/page.tsx',
  'app/[tenant]/ventas/reservas/page.tsx',
  'app/[tenant]/ventas/registro/page.tsx',
  'app/[tenant]/ventas/registro/nueva/page.tsx',
  'app/[tenant]/ventas/registro/[id]/page.tsx',
  'app/[tenant]/tasks/page.tsx',
  'app/[tenant]/perfil/page.tsx',
  'app/[tenant]/analitica/embudo/page.tsx',
  'app/[tenant]/crm/contactos/[id]/page.tsx',
  'app/[tenant]/marketing/contenido/page.tsx',
  'app/[tenant]/marketing/adquisicion/campanas/page.tsx',
  'app/[tenant]/finanzas/gastos-facturas/gastos/page.tsx',
  'app/[tenant]/csm-events/page.tsx',
  'app/[tenant]/drops/page.tsx',
  'app/[tenant]/contratos/page.tsx',
  'app/[tenant]/recursos/biblioteca/page.tsx',
  'components/os/ScriptQueue.tsx',
  'components/os/FeedbackDialog.tsx',
]

test('el cierre de la cascada reutiliza la sesión tanto al cargar como al escribir', () => {
  for (const f of CIERRE_PANTALLAS) {
    const codigo = sinComentarios(leer(f))
    assert.match(codigo, /useSesion\(\)/, f)
    assert.doesNotMatch(codigo, /auth\.getUser\(\)/, `${f} vuelve a pedir una sesión ya resuelta`)
  }
})

test('solo el layout resuelve auth.getUser en las pantallas protegidas', () => {
  const conLecturaPropia = []
  const walk = (d) => {
    for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && /auth\.getUser\(\)/.test(sinComentarios(leer(p)))) conLecturaPropia.push(p)
    }
  }
  walk('app/[tenant]')
  assert.deepEqual(conLecturaPropia, ['app/[tenant]/layout.tsx'])
})

test('ninguna pantalla migrada vuelve a leer su propia fila de users', () => {
  // El patrón exacto: from('users') ... .eq('id', <el propio usuario>) ... .single()
  const relectura =
    /from\('users'\)[\s\S]{0,300}?\.eq\('id',\s*(?:auth)?[Uu]ser(?:\.user)?\.id\)[\s\S]{0,40}?\.(single|maybeSingle)\(\)/
  for (const f of MIGRADAS) {
    assert.doesNotMatch(sinComentarios(leer(f)), relectura, f)
  }
})

test('todas usan la sesión del layout', () => {
  for (const f of MIGRADAS) {
    const codigo = sinComentarios(leer(f))
    assert.match(codigo, /useSesion\(\)/, f)
  }
})

// Sin `sesion` en las dependencias, la carga se quedaría con el valor capturado en el primer render.
test('las cargas migradas dependen de la sesión', () => {
  for (const f of MIGRADAS) {
    const codigo = sinComentarios(leer(f))
    assert.match(codigo, /\}, \[[^\]]*sesion[^\]]*\]\)/, `${f} no reacciona a la sesión`)
  }
})

// KPIReportPanel tenía además el bug del loader colgado: setLoading(true) y un return sin apagarlo.
test('KPIReportPanel apaga el loader al salir sin sesión', () => {
  const codigo = sinComentarios(leer('components/kpi/KPIReportPanel.tsx'))
  assert.match(codigo, /if \(!sesion\) \{\s*setLoading\(false\)\s*return\s*\}/)
})

// settings/page.tsx hacía TRES llamadas en serie, incluida rpc('is_super_admin'), que el layout ya hace.
test('settings ya no repite la llamada de super admin', () => {
  const codigo = sinComentarios(leer('app/[tenant]/settings/page.tsx'))
  assert.doesNotMatch(codigo, /rpc\('is_super_admin'\)/)
  assert.match(codigo, /setIsSuperAdmin\(sesion\.isSuperAdmin\)/)
})

// ---------------------------------------------------------------------------------------------
// NINGÚN CATCH VACÍO SIN EXPLICACIÓN. Un catch vacío sin motivo escrito es indistinguible de un bug:
// nadie sabe si se traga el error a propósito o por descuido.
// ---------------------------------------------------------------------------------------------

test('no queda ningún catch vacío en la aplicación', () => {
  const dirs = ['app', 'components', 'lib']
  const vacios = []
  const walk = (d) => {
    for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(leer(p))) vacios.push(p)
    }
  }
  dirs.forEach(walk)
  assert.deepEqual(vacios, [], 'un catch vacío tiene que decir por qué se ignora el error')
})

// ---------------------------------------------------------------------------------------------
// EL HELPER CANÓNICO DE NO-SHOW, USADO DONDE TOCA — Y NO DONDE NO TOCA.
//
// `isNoShow()` existe para no repetir el literal, pero tres vocabularios distintos usan la MISMA
// palabra 'no_show': `appointments.status`, `csm_events.status` y el `result` del marcado. Unificarlos
// porque coinciden en el literal ataría cálculos que no tienen nada que ver.
// ---------------------------------------------------------------------------------------------

test('el status de la cita se pregunta con el helper, no con el literal', () => {
  const ficheros = [
    'lib/analytics.ts',
    'app/[tenant]/analitica/ranking/page.tsx',
    'lib/metrics/oferta.ts',
    'app/[tenant]/crm/agendas/page.tsx',
    'app/[tenant]/crm/contactos/[id]/page.tsx',
    'components/appointments/AppointmentDetail.tsx',
  ]
  for (const f of ficheros) {
    const codigo = sinComentarios(leer(f))
    assert.doesNotMatch(codigo, /\.status === 'no_show'/, `${f} compara el status a mano`)
    assert.doesNotMatch(codigo, /rescheduled_from_status === 'no_show'/, f)
    assert.match(codigo, /isNoShow\(/, f)
  }
})

// Lo que NO se unificó, y por qué. Si estas notas desaparecen, el siguiente pase de limpieza las
// "arreglará" y romperá dos cálculos distintos.
test('los vocabularios que solo comparten el literal quedan explicados', () => {
  const csm = leer('app/[tenant]/csm-events/page.tsx')
  assert.match(csm, /NO `appointments\.status`/)
  assert.match(csm, /NO usar aquí `isNoShow\(\)`/)
  const oferta = leer('lib/metrics/oferta.ts')
  assert.match(oferta, /vocabulario del MARCADO/)
  assert.match(oferta, /aquí NO va `isNoShow\(\)`/)
})

test('csm-events y el marcado siguen usando su propio literal', () => {
  // Que la nota exista no basta: el código tiene que seguir comparando su propio vocabulario.
  assert.match(leer('app/[tenant]/csm-events/page.tsx'), /e\.status === 'no_show'/)
  assert.match(leer('lib/metrics/oferta.ts'), /cita\.result === 'no_show'/)
})
