import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolverModelo } from '../../lib/ai/modelos.ts'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const disponibles = [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }]

test('sin modelo elegido se usa uno que EXISTE, no una constante del código', () => {
  // Un nombre fijo en el código deja la IA muerta en cuanto el proveedor lo retira, y el panel sigue
  // en verde porque la credencial es válida.
  assert.equal(resolverModelo('', disponibles, ['deepseek-chat']).modelo, 'deepseek-chat')
  // Si el preferido no está en la cuenta, se cae al primero que la API sí ofrece.
  assert.equal(resolverModelo(null, disponibles, ['modelo-que-no-existe']).modelo, 'deepseek-chat')
  assert.equal(resolverModelo('', [{ id: 'otro-modelo' }], ['deepseek-chat']).modelo, 'otro-modelo')
})

test('un modelo guardado que ya no existe se AVISA, no se usa a ciegas', () => {
  const r = resolverModelo('deepseek-v4-flash', disponibles)
  assert.equal(r.modelo, null)
  assert.match(r.aviso ?? '', /ya no está disponible/)
  assert.match(r.aviso ?? '', /deepseek-chat/)
})

test('el modelo inventado ya no está en ningún sitio del código', () => {
  // `deepseek-v4-flash` estaba como valor por defecto y como placeholder, sin que nadie comprobara
  // que existiera.
  for (const f of ['../../lib/ai/provider.ts', '../../lib/integrations-catalog.ts']) {
    assert.ok(!read(f).includes('deepseek-v4-flash'), `${f} sigue nombrando el modelo sin verificar`)
  }
})

test('los modelos se piden al proveedor, con su error distinguido', () => {
  const mod = read('../../lib/ai/modelos.ts')
  assert.match(mod, /\/models/)
  // "No se pudo llegar" se arregla esperando; "respondió que no" cambiando la clave. Colapsarlos
  // manda a rotar credenciales que están bien.
  for (const code of ['sin_credenciales', 'token_invalido', 'red', 'respuesta_inesperada']) {
    assert.ok(mod.includes(`'${code}'`), `falta el código ${code}`)
  }
  assert.match(mod, /AbortSignal\.timeout/)
  // La UI ofrece la lista real en vez de un campo de texto libre.
  const ui = read('../../app/[tenant]/settings/integraciones/page.tsx')
  assert.match(ui, /Buscar modelos/)
  assert.match(ui, /Automático \(el primero disponible\)/)
})

test('el reintento de Fathom NO baja el listón del emparejamiento', () => {
  const ruta = read('../../app/api/[tenant]/evergreen/fathom-revision/reintentar/route.ts')
  // Se reutiliza decideMatch con las MISMAS reglas: no hay una segunda lógica más permisiva.
  assert.match(ruta, /import \{ decideMatch/)
  assert.match(ruta, /decision\.kind !== 'match' && decision\.kind !== 'ya_importada'/)
  // Las ambiguas siguen esperando a una persona: elegir entre dos citas a la misma hora es adivinar.
  assert.match(ruta, /siguen\s*\n?.*esperando a una persona|'ambigua' y 'sin_candidatos' siguen/)
  assert.match(ruta, /\.eq\('status', 'pendiente'\)/)
})

test('el reintento pide los datos en bloque, no una consulta por reunión', () => {
  const ruta = read('../../app/api/[tenant]/evergreen/fathom-revision/reintentar/route.ts')
  // Con 177 filas en cola, una consulta por fila son 354 viajes y un timeout.
  assert.match(ruta, /\.in\('email_normalized', emails\)/)
  assert.match(ruta, /\.in\('contact_id', contactIds\)/)
  // Y exige rol de gestión: cierra filas de la cola y escribe en citas.
  assert.match(ruta, /\['admin', 'director'\]\.includes/)
})
