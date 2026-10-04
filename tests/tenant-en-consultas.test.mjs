import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// AUDITORÍA F19 — EL SELECTOR DE SUBCUENTA TIENE QUE ACOTAR LAS CONSULTAS.
//
// RLS comprueba que quien pregunta PERTENECE a alguna subcuenta; no sabe cuál está mirando. Quien
// administra varias veía, en la pantalla de una, las ventas, gastos, tareas o conversaciones de las
// demás sumadas a las suyas, y en el registro de ventas (que sí filtraba) no aparecían: dos cifras
// distintas para la misma subcuenta. Cada consulta de lectura o borrado a una tabla con `tenant_id`
// debe llevar el filtro, o quedar acotada por un identificador que ya se validó contra la subcuenta.
//
// Se analiza la CADENA EXACTA de llamadas (con sus paréntesis balanceados), no una ventana de texto:
// un `select` largo empujaba el `.eq('tenant_id')` fuera de la ventana y daba falsos positivos.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const fixtures = readdirSync(join(root, 'tests/fixtures')).filter((f) => f.startsWith('esquema-produccion'))
const snapshot = JSON.parse(readFileSync(join(root, 'tests/fixtures', fixtures.sort().at(-1)), 'utf8'))
const CON_TENANT = new Set(snapshot.filter((t) => t.tieneTenantId).map((t) => t.tabla))

// Acotar por estos identificadores cuenta como acotar por subcuenta SOLO si el id viene de un
// registro que la ruta ya validó. El test no puede comprobarlo: por eso la lista de excepciones
// de abajo es explícita y cada una dice por qué es segura.
const ACOTA_POR_ID = /\.(eq|in)\(\s*'(id|contact_id|sale_id|appointment_id|collection_id|job_id|user_id)'/

// Excepciones CERRADAS. Clave: `fichero|tabla`. Cada una está acotada por algo que el test no ve.
const EXCEPCIONES = {
  'lib/integrations/sync-runs.ts|integration_sync_runs':
    'barrido global de ejecuciones colgadas: cierra los `running` viejos de TODAS las subcuentas por diseño',
  'app/api/[tenant]/evergreen/collections/[id]/route.ts|collections':
    'solo se llama con el installment_id del cobro que la ruta ya validó contra la subcuenta',
  'app/api/[tenant]/evergreen/emails/[id]/route.ts|email_events':
    'los eventos se piden por email_message_id justo después de leer ese mensaje con tenant_id',
}

function ficheros(dir, acc = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const rel = join(dir, e.name)
    if (e.isDirectory()) ficheros(rel, acc)
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(rel)
  }
  return acc
}

const sinComentarios = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => ' '.repeat(m.length))

function cierre(s, i) {
  let d = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === '(') d++
    else if (s[j] === ')' && --d === 0) return j
  }
  return -1
}

function cadena(s, desde) {
  let i = desde
  let out = ''
  for (;;) {
    const m = /^\s*\.([a-zA-Z_]+)\s*\(/.exec(s.slice(i, i + 400))
    if (!m) break
    const ap = i + m[0].length - 1
    const c = cierre(s, ap)
    if (c < 0) break
    out += `.${m[1]}${s.slice(ap, c + 1)}`
    i = c + 1
  }
  return out
}

function infractores() {
  const fuera = []
  for (const f of [...ficheros('app'), ...ficheros('components'), ...ficheros('lib')]) {
    const s = sinComentarios(readFileSync(join(root, f), 'utf8'))
    for (const m of s.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)) {
      if (!CON_TENANT.has(m[1])) continue
      const ch = cadena(s, m.index + m[0].length)
      // Inserts y upserts llevan el tenant en el cuerpo, y la política WITH CHECK lo exige.
      if (!/^\.(select|update|delete)\(/.test(ch)) continue
      if (/tenant_id/.test(ch) || ACOTA_POR_ID.test(ch)) continue
      fuera.push({ clave: `${f}|${m[1]}`, linea: s.slice(0, m.index).split('\n').length })
    }
  }
  return fuera
}

test('toda consulta a una tabla con tenant_id la acota por subcuenta', () => {
  const sin = infractores().filter((i) => !(i.clave in EXCEPCIONES))
  assert.deepEqual(
    sin.map((i) => `${i.clave.replace('|', ' → ')} (línea ${i.linea})`),
    [],
    "falta .eq('tenant_id', …): RLS no sabe qué subcuenta se está mirando"
  )
})

test('las excepciones siguen siendo necesarias: si ya se acotó, hay que quitarlas', () => {
  // Una lista de excepciones que se queda vieja deja de medir y pasa a ser decoración.
  const vivas = new Set(infractores().map((i) => i.clave))
  for (const clave of Object.keys(EXCEPCIONES)) {
    assert.ok(vivas.has(clave), `"${clave}" ya lleva filtro: quítala de EXCEPCIONES`)
  }
})

test('el selector de usuarios pasa por tenant_members, no lee users entero', () => {
  // `users` no tiene tenant_id: la pertenencia vive en tenant_members. Antes los desplegables de
  // tareas, gastos, contenido, CSM y biblioteca listaban a las personas de TODAS las subcuentas.
  const src = readFileSync(join(root, 'lib/users.ts'), 'utf8')
  assert.match(src, /activeUserNamesQuery\(supabase: ReturnType<typeof createClient>, tenantId: string\)/)
  assert.match(src, /tenant_members!inner\(tenant_id\)/)
  assert.match(src, /\.eq\('tenant_members\.tenant_id', tenantId\)/)
})

test('las reglas de comisión de un contrato salen de la subcuenta del contrato', () => {
  // `sb` es service-role: sin el filtro, las condiciones del contrato se calculaban con las reglas
  // de todas las subcuentas.
  const src = readFileSync(join(root, 'lib/contracts/team-contract.ts'), 'utf8')
  assert.match(src, /from\('commission_rules'\)\.select\('\*'\)\.eq\('tenant_id', tenantId\)/)
})
