import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// EL LOGIN DE UNA SUBCUENTA QUE NO EXISTE.
//
// El formulario se pintaba idéntico para un slug inexistente: escribías usuario y contraseña, y
// solo DESPUÉS de enviarlos salía "No tienes acceso a esta subcuenta" — un mensaje que hace pensar
// en un problema de permisos cuando en realidad es una errata en la dirección. Una `s` de más en el
// slug (`women-digital-closers` por `women-digital-closer`) costó una sesión entera de diagnóstico
// a un usuario que además era super_admin y tenía acceso a todo.
//
// Estos tests fijan las tres propiedades del arreglo: se comprueba antes de pedir nada, un fallo de
// red no bloquea el acceso, y no se enumera ninguna otra subcuenta al hacerlo.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const login = read('app/[tenant]/login/page.tsx')
const home = read('app/page.tsx')

test('la existencia de la subcuenta se comprueba antes de pedir credenciales', () => {
  assert.match(login, /public_tenant_branding/, 'debe consultarse el slug al cargar')
  const comprueba = login.indexOf("rpc('public_tenant_branding'")
  const formulario = login.indexOf('onSubmit={handleSubmit}')
  assert.ok(comprueba > -1 && formulario > -1)
  assert.ok(comprueba < formulario, 'la comprobación va antes del formulario')
})

test('con subcuenta desconocida no se muestra el formulario', () => {
  assert.match(login, /subcuenta === 'desconocida' \? \(/)
  assert.match(login, /Esta subcuenta no existe/)
  // Y se nombra la causa probable en vez de insinuar un problema de permisos.
  assert.match(login, /errata en\s*\n?\s*la dirección/)
})

test('un fallo de red no bloquea el acceso: se deja pasar al formulario', () => {
  // Negar la entrada por un error transitorio de la RPC sería peor que el problema que arregla.
  assert.match(login, /if \(rpcError\) return setSubcuenta\('existe'\)/)
})

test('la comprobación previa usa la RPC pública; la lectura de tenants sigue siendo la de después', () => {
  // `anon` ya no lee `tenants` (migración 20260919110000), así que la comprobación PREVIA tiene que
  // ir por la RPC: hay que acertar el slug para obtener respuesta, con lo que confirma uno sin
  // listar ninguno. La lectura de `tenants` sí existe, pero es la verificación de pertenencia de
  // DESPUÉS del login, que corre con sesión y se apoya en RLS. Son dos cosas distintas y el orden
  // lo demuestra.
  const rpc = login.indexOf("rpc('public_tenant_branding'")
  const auth = login.indexOf('signInWithPassword')
  const leeTenants = login.indexOf("from('tenants')")
  assert.ok(rpc > -1 && auth > -1 && leeTenants > -1)
  assert.ok(rpc < auth, 'la RPC previa va antes de autenticar')
  assert.ok(leeTenants > auth, 'la lectura de tenants es posterior al login, no un sustituto de la RPC')
})

test('el atajo de la home recuerda solo la subcuenta de quien mira', () => {
  // La regla de no-enumeración (§42) prohíbe listar subcuentas sin sesión: revelaría los nombres de
  // los clientes. El historial del propio navegador no revela nada ajeno, así que el atajo es
  // compatible con esa regla y evita escribir el identificador a mano.
  assert.match(home, /localStorage\.getItem\('gop:ultima-subcuenta'\)/)
  assert.match(login, /localStorage\.setItem\('gop:ultima-subcuenta', tenant\)/)
  // Se escribe SOLO tras un login correcto, nunca al cargar la página.
  const guarda = login.indexOf("setItem('gop:ultima-subcuenta'")
  const verifica = login.indexOf('No tienes acceso a esta subcuenta')
  assert.ok(verifica > -1 && guarda > verifica, 'guardar va después de la verificación de pertenencia')
})

test('el almacenamiento bloqueado no rompe nada', () => {
  // Modo privado o cookies bloqueadas: el atajo es comodidad, nunca requisito.
  for (const src of [home, login]) {
    assert.match(src, /try \{\s*\n?\s*(set|localStorage)/, 'los accesos a localStorage van protegidos')
  }
})

// ── RECUPERACIÓN DE CONTRASEÑA ───────────────────────────────────────────────────────────────

const recover = read('app/[tenant]/recover/page.tsx')

test('con subcuenta inexistente, recuperar NO cae al flujo genérico de Supabase', () => {
  // La ruta devuelve 404 si el slug no existe. Antes, la página lo trataba como "el endpoint no
  // sirvió" y usaba el flujo de Supabase, que NO sabe de subcuentas: mandaba un correo genérico con
  // un enlace de vuelta a una dirección inexistente, y la pantalla decía "revisa tu correo". Se
  // esperaba un correo que nunca iba a servir.
  assert.match(recover, /res\.status === 404/)
  const corta = recover.indexOf('res.status === 404')
  const fallback = recover.indexOf('resetPasswordForEmail')
  assert.ok(corta > -1 && fallback > -1)
  assert.ok(corta < fallback, 'el 404 se atiende antes de llegar al fallback')
})

test('el 404 nombra la causa probable y no marca el envío como hecho', () => {
  const bloque = recover.slice(recover.indexOf('res.status === 404'), recover.indexOf('resetPasswordForEmail'))
  assert.match(bloque, /Esta subcuenta no existe/)
  assert.match(bloque, /errata/)
  assert.doesNotMatch(bloque, /setSent\(true\)/, 'no puede decir que se envió algo que no se envió')
})
