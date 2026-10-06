import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('la identidad aparece una sola vez y todas sus acciones viven en el header', () => {
  const header = read('components/os/Header.tsx')
  const sidebar = read('components/os/Sidebar.tsx')

  assert.match(header, /Abrir cuenta de/)
  assert.match(header, /Mi perfil y contraseña/)
  assert.match(header, /Cerrar sesión/)
  assert.doesNotMatch(sidebar, /User section|ROLE_LABELS|Cerrar sesión|getInitials\(user\.full_name\)/)
})

test('el superadmin conserva acceso global y entrada explícita a Ver como', () => {
  const header = read('components/os/Header.tsx')
  const users = read('app/[tenant]/settings/users/page.tsx')

  assert.match(header, /Superadministrador: puedes cambiar de subcuenta/)
  assert.match(header, /href={`\/\$\{tenant\}\/settings\/users`}/)
  assert.match(header, /Ver como otro usuario/)
  assert.match(users, /isSuperAdminSesion/)
  assert.match(users, /onClick=\{\(\) => verComo\(user\)\}/)
  assert.match(users, /Ver como esta persona/)
})
