import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('el logo pertenece al branding canónico y conserva un fallback seguro', async () => {
  const [branding, logo, sidebar] = await Promise.all([
    read('lib/tenant-branding.ts'),
    read('components/os/TenantLogo.tsx'),
    read('components/os/Sidebar.tsx'),
  ])

  assert.match(branding, /logo_url/)
  assert.match(branding, /\^https:/)
  assert.match(logo, /onError=\{\(\) => setFailed\(true\)\}/)
  assert.match(logo, /branding\.name\.charAt\(0\)/)
  assert.match(sidebar, /<TenantLogo branding=\{branding\} \/>/)
})

test('la escritura del logo está aislada por tenant y reservada a administradores', async () => {
  const route = await read('app/api/[tenant]/evergreen/settings/branding/route.ts')

  assert.match(route, /requireTenant\(tenant\)/)
  assert.match(route, /!auth\.administraTenant/)
  assert.match(route, /\.eq\('id', tenantId\)/)
  assert.match(route, /MAX_LOGO_BYTES = 4 \* 1024 \* 1024/)
  assert.match(route, /hasValidSignature/)
  assert.doesNotMatch(route, /image\/svg/)
})

test('Datos de empresa permite subir, reemplazar y quitar el logo sin recargar', async () => {
  const page = await read('app/[tenant]/settings/empresa/page.tsx')
  const layout = await read('app/[tenant]/layout.tsx')

  assert.match(page, /accept="image\/png,image\/jpeg,image\/webp"/)
  assert.match(page, /method: 'DELETE'/)
  assert.match(page, /growthops:tenant-branding-changed/)
  assert.match(layout, /addEventListener\('growthops:tenant-branding-changed'/)
})
