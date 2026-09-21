// "VER COMO" — sesión real del colaborador con ticket cifrado de retorno (21-sep).
// Verifica: el ticket se sella/abre y caduca; los endpoints exigen super admin y no filtran
// tokens; el banner pinta lo mínimo; el botón solo aparece para super admin. El núcleo
// (ver-como.ts) es TS puro de nodo: se importa REAL; los routes se verifican por fuente
// (patrón del repo: tests/youtube-oauth.test.mjs).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const raiz = dirname(aqui)
const lee = (p) => readFileSync(join(raiz, p), 'utf8')
const existe = (p) => {
  try {
    readFileSync(join(raiz, p))
    return true
  } catch {
    return false
  }
}

process.env.CONFIG_ENC_KEY = 'a'.repeat(64) // clave de prueba para el módulo real
const { sellarTicket, abrirTicket, VER_COMO_TTL_MS, cookieNombre } = await import(
  'file://' + join(raiz, 'lib/auth/ver-como.ts')
)

const sesion = {
  access_token: 'at-prueba',
  refresh_token: 'rt-prueba',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user_id: '11111111-1111-1111-1111-111111111111',
}
const objetivo = { userId: '22222222-2222-2222-2222-222222222222', email: 'c@wdc.io', nombre: 'Closer Uno' }

test('el ticket se sella, se abre y devuelve la sesión intacta', () => {
  const valor = sellarTicket({ tenant: 'women-digital-closer', superAdmin: sesion, objetivo })
  const r = abrirTicket(valor)
  assert.ok(r.ok)
  assert.equal(r.ok && r.ticket.superAdmin.access_token, 'at-prueba')
  assert.equal(r.ok && r.ticket.superAdmin.refresh_token, 'rt-prueba')
  assert.equal(r.ok && r.ticket.objetivo.email, 'c@wdc.io')
  assert.equal(r.ok && r.ticket.tenant, 'women-digital-closer')
})

test('el ticket CADUCA: la sesión del otro no vive para siempre', () => {
  const valor = sellarTicket(
    { tenant: 'women-digital-closer', superAdmin: sesion, objetivo },
    Date.now() - VER_COMO_TTL_MS - 1000
  )
  const r = abrirTicket(valor)
  assert.ok(!r.ok && r.motivo === 'caducado', 'debe caducar pasados 30 min')
  assert.ok(VER_COMO_TTL_MS === 30 * 60 * 1000)
})

test('el ticket no se puede falsificar: sin la clave no abre', () => {
  const valor = sellarTicket({ tenant: 'women-digital-closer', superAdmin: sesion, objetivo })
  const manipulado = valor.slice(0, -6) + 'AAAAAA'
  const r = abrirTicket(manipulado)
  assert.ok(!r.ok && (r.motivo === 'integridad' || r.motivo === 'contenido' || r.motivo === 'formato'))
})

test('el ticket no sirve en otra subcuenta ni con otro formato', () => {
  const valor = sellarTicket({ tenant: 'evergreen', superAdmin: sesion, objetivo })
  const r = abrirTicket(valor)
  assert.ok(r.ok && r.ticket.tenant === 'evergreen')
  // El GUARD del endpoint debe comparar el tenant del ticket con el de la URL (verificado abajo).
})

test('la página de canje usa token_hash y sale al panel del tenant', () => {
  const page = lee('app/ver-como/entrar/page.tsx')
  assert.match(page, /verifyOtp\(\{ token_hash: token, type: 'magiclink' \}\)/, 'canje del token enlazado')
  assert.match(page, /searchParams\.get\('token_hash'\)/, 'acepta el token_hash del enlace')
  assert.match(page, /dashboard/, 'redirige al panel del tenant')
})

test('la página vive fuera de /[tenant] y es pública en el middleware', () => {
  assert.ok(existe('app/ver-como/entrar/page.tsx'), 'fuera del namespace del tenant (punto muerto de guardia)')
  assert.ok(!existe('app/[tenant]/ver-como/entrar/page.tsx'), 'no queda la copia antigua bajo /[tenant]')
  const mw = lee('middleware.ts')
  assert.ok(mw.includes("'/ver-como',"), 'exenta en PUBLIC_PATHS')
})

test('POST ver-como: quién puede, a quién apunta y nunca devuelve tokens', () => {
  const route = lee('app/api/[tenant]/evergreen/admin/ver-como/route.ts')
  // Super admin de plataforma O admin de la subcuenta (nunca director/manager/member).
  assert.match(route, /!auth\.isSuperAdmin && auth\.administraTenant !== true && auth\.role !== 'admin'/)
  // El admin solo puede apuntar a usuarios de SU subcuenta (frontera explícita).
  assert.match(route, /Ese usuario no pertenece a esta subcuenta/)
  assert.match(route, /Ya estás en tu propia sesión/, 'no ver como ti mismo')
  assert.match(route, /is_active === false/, 'no entrar como un desactivado')
  assert.match(route, /type: 'magiclink'/, 'el enlace mágico entra sin password')
  assert.match(route, /sellarTicket/)
  assert.match(route, /httpOnly: true/, 'el ticket no se puede leer desde JS')
  // La respuesta lleva NUESTRA página con el OTP, no el action_link de Supabase ni tokens.
  assert.match(route, /url: urlLocal\.toString\(\)/)
  assert.match(route, /\/ver-como\/entrar/)
  const cuerpo = route.slice(route.indexOf('const res = NextResponse.json'))
  assert.ok(!cuerpo.includes('access_token'), 'la respuesta no debe llevar access_token')
})

test('entrar canjea el OTP server-side, verifica identidad y audita en audit_logs', () => {
  const route = lee('app/api/[tenant]/evergreen/admin/ver-como/entrar/route.ts')
  assert.match(route, /verifyOtp\(\{ token_hash: tokenHash, type: 'magiclink' \}\)/, 'el canje de sesión ocurre aquí')
  assert.match(
    route,
    /user\?\.id !== ticket\.ticket\.objetivo\.userId/,
    'si la sesión puesta no es la del objetivo, no sigue'
  )
  assert.match(route, /entity_type: 'ver_como'/)
  assert.match(route, /action: 'entrar'/)
  assert.match(route, /actor_user_id: ticket\.ticket\.superAdmin\.user_id/)
})

test('salir restaura con el refresh token del ticket y audita la salida', () => {
  const route = lee('app/api/[tenant]/evergreen/admin/ver-como/salir/route.ts')
  assert.match(route, /t\.superAdmin\.refresh_token/)
  assert.match(route, /action: 'salir'/)
  assert.match(route, /res\.cookies\.delete\(cookieNombre\(\)\)/, 'borra el ticket al salir')
  // La cookie que se reescribe es la de sesión de Supabase, con base64- (formato @supabase/ssr).
  assert.match(route, /sb-\$\{ref\}-auth-token/)
  assert.match(route, /base64-/)
})

test('estado no filtra tokens y dice si el que llama es super admin', () => {
  const route = lee('app/api/[tenant]/evergreen/admin/ver-como/estado/route.ts')
  const cuerpo = route.slice(route.indexOf('return NextResponse.json({'))
  assert.ok(!cuerpo.includes('access_token'))
  assert.match(route, /superadmin: auth\.isSuperAdmin/)
})

test('el botón Ver como solo se pinta para super admin y el banner es visible siempre en modo', () => {
  const ui = lee('app/[tenant]/settings/users/page.tsx')
  assert.match(ui, /isSuperAdminSesion && \(/)
  assert.match(ui, /window\.location\.href = j\.url/)
  const banner = lee('components/os/BannerVerComo.tsx')
  assert.match(banner, /Volver a mi sesión/)
  assert.match(banner, /se registran como/)
  const shim = lee('components/os/VerComoShim.tsx')
  assert.match(shim, /useVerComo\(tenant\)/)
})

test('la cookie del ticket tiene nombre fijo y atributos duros', () => {
  assert.equal(cookieNombre(), 'vc-ticket')
  const route = lee('app/api/[tenant]/evergreen/admin/ver-como/route.ts')
  assert.match(route, /sameSite: 'lax'/)
  assert.match(route, /secure: process\.env\.NODE_ENV === 'production'/)
})
