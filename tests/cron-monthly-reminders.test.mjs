import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// PR-R0.2 — REGRESIÓN DE LOS CRONS `monthly` y `reminders` (RECOVERY_ROADMAP.md).
//
// Los dos crons deciden dinero: el primero genera el gasto de sueldos y gastos recurrentes del
// mes; el segundo marca cuotas vencidas y APRUEBA comisiones al pasar la ventana de devolución.
// Supabase-js no lanza en fallo: devuelve `{ error }`. Hasta el 26-sep varias lecturas se trataban
// como "lista vacía" y varias escrituras iban sin comprobar: el cron respondía `ok` con el sueldo
// del mes AUSENTE o la comisión SIN aprobar, y nada en ningún panel lo delataba (hallazgos P1 del
// relevo del 26-sep; mismo patrón que #231/#236).
//
// Estilo de la casa para rutas con BD (`webhook-ghl.test.mjs`, `stripe-webhook-route.test.mjs`):
// invariantes estáticos sobre el código — no ejecutan la ruta porque exigirían una base de datos.
// Los comentarios se eliminan antes de analizar para que un invariante nunca "pase" porque la
// frase aparece en una nota.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const limpiar = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

const monthly = limpiar(read('app/api/[tenant]/evergreen/cron/monthly/route.ts'))
const reminders = limpiar(read('app/api/[tenant]/evergreen/cron/reminders/route.ts'))

const getDe = (src) => src.split('export async function GET')[1].split('export async function POST')[0]

// ── CRON MONTHLY: ninguna lectura se convierte en "mes sin gastos" ───────────────────────────

test('monthly: ninguna lectura del equipo, plantillas o comisiones se traga como lista vacía', () => {
  // Antes: `const { data: memberIds } = await sb.from('tenant_members')...` sin comprobar. Un
  // fallo de lectura producía equipo vacío → cero gastos de sueldo → respuesta `ok`. Un hueco no
  // es un cero.
  assert.match(monthly, /No se pudo leer el equipo de la subcuenta/)
  assert.match(monthly, /No se pudo leer el equipo activo/)
  assert.match(monthly, /No se pudieron leer las comisiones del periodo/)
  assert.match(monthly, /No se pudieron leer las plantillas de gastos recurrentes/)
  // El upsert y las sincronizaciones de importe también verifican: un gasto no creado o no
  // actualizado no puede responder `ok`.
  assert.match(monthly, /No se pudieron crear los gastos del periodo/)
  assert.match(monthly, /No se pudo sincronizar el importe de/)
})

test('monthly: un recorte de paginado en comisiones tumba el run, no produce un gasto menor', () => {
  // El comentario histórico de la ruta lo advierte: PostgREST recorta a 1.000 filas sin avisar y
  // el sueldo salía "con toda la pinta de dato bueno". `fetchAllRows` declara `truncated`; ignorar
  // sería exactamente el error que el paginado vino a arreglar.
  assert.match(monthly, /truncated/)
  assert.match(monthly, /TODAS las comisiones del periodo/)
})

test('monthly: un fallo de subcuenta deja el trigger en rojo para que se reintente', () => {
  const get = getDe(monthly)
  // El 200 "con errores dentro" enterraba el fallo en la respuesta: el run quedaba verde y el mes
  // se perdía (el rerun solo regenera el periodo actual). Ahora 500; el rerun es idempotente por
  // (auto_source, period).
  const hayError = get.indexOf("'error' in r")
  const quinientos = get.indexOf('status: 500', hayError)
  assert.ok(hayError > -1, 'el GET debe inspeccionar los errores por subcuenta')
  assert.ok(quinientos > hayError, 'con errores por subcuenta el GET responde 500')
  assert.match(get, /ok: false/)
})

test('monthly: el presupuesto de tiempo es menor que maxDuration y el corte no se informa como fallo', () => {
  // calendly-ghl murió con 504 gastando 35+25=60 s exactos: el presupuesto de trabajo queda por
  // debajo del deadline de la función y un corte se declara (`cortado`) en vez de contarse como
  // error — la pasada siguiente continúa (upsert idempotente).
  assert.match(monthly, /export const maxDuration = 60/)
  assert.match(monthly, /const TIME_BUDGET_MS = \d+_000/)
  assert.match(monthly, /cortado: true/)
  // La condición de 500 del GET solo mira 'error', nunca 'cortado'.
  const get = getDe(monthly)
  const condicion = get.slice(get.indexOf('if (Object.values'))
  assert.match(condicion, /'error' in r/)
  assert.doesNotMatch(condicion.slice(0, condicion.indexOf(')') + 1), /cortado/)
})

// ── CRON REMINDERS: ninguna escritura de dinero se queda sin aplicar en silencio ─────────────

test('reminders: marcar vencidas y aprobar comisiones verifican el error de la escritura/lectura', () => {
  // El paso 2 APRUEBA COMISIONES: su lectura de ventas elegibles se tragaba como "no hay nada que
  // aprobar" y su update iba sin comprobar — dinero que no se movía con respuesta 200.
  assert.match(reminders, /No se pudieron marcar las cuotas vencidas/)
  assert.match(reminders, /No se pudieron leer las ventas fuera de ventana de devolución/)
  assert.match(reminders, /No se pudieron aprobar las comisiones fuera de ventana/)
})

test('reminders: el flag de limpieza de Calendly no se baja fire-and-forget', () => {
  // Si el update del flag falla en silencio, el reintento se repite contra Calendly para siempre
  // (la 2ª llamada es 404/409 y se daba por resuelta). No se cuenta como resuelto: la pasada
  // siguiente lo reintenta.
  assert.match(reminders, /No se pudo cerrar el reintento de Calendly/)
  const guardia = reminders.indexOf('flagErr')
  const cuenta = reminders.indexOf('calendlyCleanedUp++')
  assert.ok(guardia > -1, 'debe existir la comprobación del error del flag')
  assert.ok(cuenta > guardia, 'el reintento solo se cuenta como resuelto si el flag se guardó')
})

test('reminders: un fallo de subcuenta responde 500 aunque el barrido haya terminado', () => {
  const get = getDe(reminders)
  assert.match(get, /huboFallos/)
  assert.match(get, /status: 500/)
  assert.match(get, /ok: false/)
  // Repetir el cron es seguro: los tres pasos son idempotentes.
  assert.match(reminders, /update\(\{ status: 'overdue' \}\)/)
})

test('reminders: el presupuesto corta el reintento externo, no los pasos de base de datos', () => {
  assert.match(reminders, /export const maxDuration = 60/)
  assert.match(reminders, /const TIME_BUDGET_MS = \d+_000/)
  // El corte vive dentro del bucle de Calendly (latencia externa), después de leer el token.
  const bucle = reminders.slice(reminders.indexOf('calendlyToken'))
  const corte = bucle.indexOf('Date.now() > deadline')
  assert.ok(corte > -1, 'el bucle de Calendly debe autolimitarse por presupuesto')
  assert.match(reminders, /cortado = true/)
})

// ── SUPERFICIES (coherencia con tenant-isolation, que solo cubre `monthly`) ──────────────────

test('reminders: GET se autentica solo con CRON_SECRET y no acepta sesión', () => {
  const get = getDe(reminders)
  assert.match(get, /CRON_SECRET/)
  assert.doesNotMatch(get, /requireTenant\(/)
})
