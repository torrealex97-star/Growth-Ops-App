import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// S0.4 · P2 — sin almacén de Vercel Blob la subida de VSL fallaba con un error técnico en inglés
// ("Vercel Blob: No read-write token found…") que llegaba tal cual a la pantalla. Pasó en producción.

const ruta = readFileSync(new URL('../app/api/[tenant]/evergreen/vsl/upload/route.ts', import.meta.url), 'utf8')

test('sin token de Blob la ruta responde antes de llamar a Blob', () => {
  const chequeo = ruta.indexOf('!process.env.BLOB_READ_WRITE_TOKEN')
  assert.ok(chequeo > -1, 'falta la comprobación del almacén')
  assert.ok(chequeo < ruta.indexOf('handleUpload({'), 'la comprobación tiene que ir antes de usar Blob')
  // Tras la autenticación: no se le cuenta a un anónimo cómo está configurada la instalación.
  assert.ok(chequeo > ruta.indexOf('requireTenant(tenant)'))
})

test('el mensaje dice qué hacer, en castellano y sin jerga', () => {
  assert.match(ruta, /pega su ' \+\s*'enlace|pega su enlace/)
  assert.doesNotMatch(ruta.slice(ruta.indexOf('MENSAJE_SIN_ALMACEN =')), /^.*BLOB_READ_WRITE_TOKEN.*'$/m)
  assert.match(ruta, /status: 503/)
})
