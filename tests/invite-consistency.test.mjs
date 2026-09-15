import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const invite = readFileSync(join(root, 'app/api/[tenant]/evergreen/invite/route.ts'), 'utf8')
const users = readFileSync(join(root, 'app/[tenant]/settings/users/page.tsx'), 'utf8')

test('el rol se valida antes de crear o recuperar una identidad', () => {
  const validaRol = invite.indexOf("from('roles')")
  const generaEnlace = invite.indexOf('generateLink({')
  assert.ok(validaRol > -1 && validaRol < generaEnlace)
  assert.match(invite, /if \(!roleKey\).*rol seleccionado no existe/)
})

test('admin y director reciben techo administrativo en la subcuenta invitada', () => {
  assert.match(invite, /ADMIN_ROLES = \['admin', 'director'\]/)
  assert.match(invite, /desiredMembershipRole = ADMIN_ROLES\.includes\(roleKey\) \? 'admin' : 'member'/)
  assert.match(invite, /role: membershipRole/)
})

test('reinvitar conserva un techo admin previo pero permite ascender member a admin', () => {
  assert.match(invite, /select\('role'\)/)
  assert.match(invite, /previousMembershipRole === 'super_admin' \|\| previousMembershipRole === 'admin'/)
  assert.match(invite, /: desiredMembershipRole/)
  assert.doesNotMatch(invite, /ignoreDuplicates: true/)
})

test('un fallo de perfil o membresía no se presenta como invitación correcta', () => {
  assert.ok(invite.indexOf("from('tenant_members')") < invite.indexOf("from('users').upsert"))
  assert.match(invite, /const \{ error: profileError \} = await/)
  assert.match(invite, /if \(profileError\)/)
  assert.match(invite, /const \{ error: membershipError \} = await/)
  assert.match(invite, /if \(membershipError\)/)
  assert.match(invite, /if \(linkType === 'invite'\) await supabase\.auth\.admin\.deleteUser\(userId\)/)
})

test('abrir Usuarios no intenta ejecutar DDL administrativo', () => {
  assert.doesNotMatch(users, /migrate-page-overrides/)
  assert.match(users, /useCallback\(async \(\) =>/)
  assert.match(users, /\}, \[tenantId\]\)/)
  assert.match(users, /\}, \[fetchData\]\)/)
})
