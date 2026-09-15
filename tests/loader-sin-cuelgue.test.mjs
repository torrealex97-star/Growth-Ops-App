import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const LAYOUT = 'app/[tenant]/layout.tsx'
const INTEGRACIONES = 'app/[tenant]/settings/integraciones/page.tsx'

// ---------------------------------------------------------------------------------------------
// LA PANTALLA NEGRA DE "CARGANDO". Estos tests fijan la causa raíz para que no vuelva.
//
// Eran dos fallos de la misma forma: un `await` sin try/catch/finally y sin techo de tiempo. Con eso
// basta —una red que se corta, un 502 con HTML en vez de JSON, una consulta que no responde— para que
// `loading` se quede en true para siempre, sin error visible y sin forma de salir salvo recargar.
// ---------------------------------------------------------------------------------------------

test('el arranque del panel apaga el loader por TODOS los caminos', () => {
  const codigo = sinComentarios(leer(LAYOUT))
  // El finally es la garantía: pase lo que pase, el loader se apaga.
  assert.match(codigo, /\.finally\(\(\) => \{[\s\S]{0,260}setLoading\(false\)/)
  // Y el catch, que no existía: una excepción abandonaba la función a mitad.
  assert.match(codigo, /\.catch\(\(e: unknown\) => \{/)
})

// El return del que salía la pantalla colgada: redirigía a login y se iba SIN apagar `loading`,
// apostando a que la redirección desmontaría el componente.
test('el camino "sin sesión" apaga el loader antes de salir', () => {
  const codigo = sinComentarios(leer(LAYOUT))
  const bloque = codigo.slice(codigo.indexOf('if (!authUser)'), codigo.indexOf('const { data: tenantRow'))
  assert.match(bloque, /router\.push/)
  assert.match(bloque, /setLoading\(false\)/, 'este return dejaba el loader encendido para siempre')
})

test('hay techo de tiempo: una consulta que no responde no cuelga la pantalla', () => {
  const codigo = sinComentarios(leer(LAYOUT))
  assert.match(codigo, /const TIMEOUT_MS = 12_000/)
  assert.match(codigo, /setTimeout\(\(\) => \{[\s\S]{0,320}setLoading\(false\)/)
  // Y se limpia al desmontar, para no dejar un timer apuntando a un componente que ya no existe.
  assert.match(codigo, /return \(\) => \{[\s\S]{0,160}clearTimeout\(porTiempo\)/)
})

test('un error de consulta no se confunde con "no tienes acceso"', () => {
  const codigo = sinComentarios(leer(LAYOUT))
  // Decirle a alguien que no tiene acceso cuando lo que falló fue la red le manda a pedir permisos
  // que ya tiene.
  assert.match(codigo, /if \(tenantErr\) throw new Error\(tenantErr\.message\)/)
})

test('el fallo se puede ver y reintentar, y se comprueba ANTES del loader', () => {
  const codigo = sinComentarios(leer(LAYOUT))
  const fallo = codigo.indexOf('if (fallo)')
  const cargando = codigo.indexOf('if (loading)')
  assert.ok(fallo > -1, 'no hay estado de fallo visible')
  assert.ok(fallo < cargando, 'el fallo tiene que ganar al loader, o se enseña un loader eterno')
  assert.match(codigo, /setIntento\(\(n\) => n \+ 1\)/, 'Reintentar tiene que reintentar de verdad')
})

// La pantalla negra literal: `dark` + bg-background con un rectángulo pulsando y la palabra "Cargando".
test('el loader del panel ya no es un rectángulo con la palabra "Cargando"', () => {
  const src = leer(LAYOUT)
  assert.doesNotMatch(src, /Cargando \{branding\.name\}/)
  assert.match(src, /<AppLoading/)
  assert.match(src, /Preparando \$\{branding\.name\}/)
})

// Waterfall: eran dos viajes de red encadenados sin que ninguno dependiera del otro, pagados en cada
// entrada al panel antes de pintar un píxel.
test('las consultas independientes del arranque van en paralelo', () => {
  const codigo = sinComentarios(leer(LAYOUT))
  assert.match(codigo, /await Promise\.all\(\[\s*supabase\.rpc\('is_super_admin'\)/)
})

// ---------------------------------------------------------------------------------------------
// INTEGRACIONES — la pantalla que se quedaba cargando.
// ---------------------------------------------------------------------------------------------

test('la carga de integraciones tiene finally y no puede dejar el loader encendido', () => {
  const codigo = sinComentarios(leer(INTEGRACIONES))
  const load = codigo.slice(
    codigo.indexOf('const load = useCallback'),
    codigo.indexOf('useEffect(() => {\n    void load()')
  )
  assert.match(load, /try \{/)
  assert.match(load, /\} finally \{\s*setLoading\(false\)/)
  // Y ya no hay un fetch crudo cuyo rechazo abandone la función a mitad.
  assert.doesNotMatch(load, /await fetch\(/)
  assert.match(load, /await pedir</)
})

test('integraciones distingue sin permiso de error, y ofrece reintento solo si sirve', () => {
  const codigo = sinComentarios(leer(INTEGRACIONES))
  assert.match(codigo, /falloCarga\.tipo === 'permiso' \? 'sin_permiso' : 'error'/)
  assert.match(codigo, /falloCarga\.reintentable \? \(\) => void load\(\) : undefined/)
})

test('el estado de fallo de integraciones se comprueba antes del de carga', () => {
  const codigo = sinComentarios(leer(INTEGRACIONES))
  assert.ok(codigo.indexOf('if (falloCarga)') < codigo.indexOf('if (loading)'))
})

// ---------------------------------------------------------------------------------------------
// ACCESIBILIDAD DEL SISTEMA DE CARGA
// ---------------------------------------------------------------------------------------------

test('los loaders se anuncian a un lector de pantalla', () => {
  const src = leer('components/ui/carga/AppLoading.tsx')
  assert.equal((src.match(/role="status"/g) || []).length >= 4, true)
  assert.match(src, /aria-live="polite"/)
  // El SVG decorativo no se anuncia: lo que se lee es el texto.
  assert.match(leer('components/ui/carga/Orbita.tsx'), /aria-hidden="true"/)
})

test('la animación respeta prefers-reduced-motion y no usa WebGL ni librerías', () => {
  // Sin comentarios: el propio fichero EXPLICA que no usa WebGL, y esa frase haría fallar la búsqueda.
  const orbita = sinComentarios(leer('components/ui/carga/Orbita.tsx'))
  assert.match(orbita, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(orbita, /animation: none/)
  assert.doesNotMatch(orbita, /webgl|framer-motion|lottie|<canvas/i)
  // Solo transform/opacity: lo mueve el compositor, no el hilo principal.
  assert.match(orbita, /transform: rotate\(360deg\)/)
  // El skeleton ya no lleva su propia regla: usa el primitivo `Skeleton` y el reduced-motion se
  // resuelve en app/globals.css para toda la app (ver el test de más abajo).
  assert.match(leer('components/ui/carga/AppLoading.tsx'), /<Skeleton key=\{i\}/)
})

test('el color del loader sale de la marca del tenant, no de un valor fijo', () => {
  assert.match(leer('components/ui/carga/Orbita.tsx'), /var\(--brand-600/)
})

test('no se inventa un porcentaje de progreso', () => {
  const src = leer('components/ui/carga/AppLoading.tsx')
  // El % solo se pinta si hay hechos Y total reales.
  assert.match(src, /const conocido =\s*typeof hechos === 'number' && typeof total === 'number' && total > 0/)
  assert.match(src, /pct !== null \?/)
})

test('los timers del loader se limpian al desmontar', () => {
  const src = sinComentarios(leer('components/ui/carga/useFaseCarga.ts'))
  assert.match(src, /return \(\) => \{[\s\S]{0,120}clearTimeout\(aVisible\)[\s\S]{0,60}clearTimeout\(aLento\)/)
})

// ---------------------------------------------------------------------------------------------
// LOS NUEVE ESTADOS, dichos como son.
// ---------------------------------------------------------------------------------------------

test('desconectado y vacío no dicen lo mismo', () => {
  const src = leer('components/ui/carga/EstadoPanel.tsx')
  assert.match(src, /no está conectado/)
  assert.match(src, /por falta de conexión, no porque no haya actividad/)
  assert.match(src, /la última sincronización falló/)
  assert.match(src, /No se rellena con un cero/)
  assert.match(src, /no un hueco de medición/)
})

test('el estado de error enseña el motivo real, no un "algo ha ido mal"', () => {
  const src = sinComentarios(leer('components/ui/carga/EstadoPanel.tsx'))
  assert.match(src, /detalle: p\.mensajeError \?\?/)
})

test('un aviso de datos desactualizados va ENCIMA de los datos, no en vez de ellos', () => {
  const src = sinComentarios(leer('components/ui/carga/EstadoPanel.tsx'))
  const bloque = src.slice(src.indexOf("=== 'cero_real' || p.estado === 'desactualizado'"))
  assert.match(bloque.slice(0, 900), /\{p\.children\}/)
})

// ---------------------------------------------------------------------------------------------
// NO DOS SISTEMAS EN PARALELO. knip había detectado que `components/ui/skeleton.tsx` y
// `components/ui/empty-state.tsx` ya existían Y NO SE USABAN. Crear otro rectángulo gris y otro
// bloque "icono + título + texto" al lado habría dejado dos apariencias distintas para lo mismo.
// ---------------------------------------------------------------------------------------------

test('el sistema de carga reutiliza los primitivos que ya existían', () => {
  const skeleton = leer('components/ui/carga/AppLoading.tsx')
  assert.match(skeleton, /import \{ Skeleton \} from '@\/components\/ui\/skeleton'/)
  assert.match(skeleton, /<Skeleton key=\{i\}/)
  const estado = leer('components/ui/carga/EstadoPanel.tsx')
  assert.match(estado, /import \{ EmptyState \} from '@\/components\/ui\/empty-state'/)
  assert.match(estado, /<EmptyState/)
})

// El reduced-motion de las utilidades de Tailwind se resuelve UNA vez, y así quedan cubiertos también
// los ~18 spinners `animate-spin` que ya había repartidos por pantallas distintas.
test('prefers-reduced-motion frena las animaciones de Tailwind en toda la app', () => {
  const css = leer('app/globals.css')
  const bloque = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.ok(bloque.length > 0, 'no hay regla global de reduced-motion')
  for (const clase of ['.animate-spin', '.animate-pulse', '.animate-bounce', '.animate-ping']) {
    assert.ok(bloque.includes(clase), `${clase} sigue animándose con reduced-motion`)
  }
  assert.match(bloque, /animation: none !important/)
  // El elemento no se oculta: deja de moverse, pero se sigue viendo.
  assert.doesNotMatch(bloque.slice(0, 600), /display:\s*none/)
})
