import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { INTEGRATION_GROUPS } from '../lib/integrations-catalog.ts'
import {
  causaErrorBunny,
  configBunny,
  faltaEnConfigBunny,
  firmaSubidaBunny,
  normalizarHostBunny,
  urlsVideoBunny,
} from '../lib/vsl/bunny.ts'

// VSL EN BUNNY STREAM. Lo que no puede fallar: que la firma sea la que Bunny acepta, que la API key
// no salga nunca del servidor, y que un hostname pegado "a su manera" no rompa las URLs en silencio.

const ruta = readFileSync(new URL('../app/api/[tenant]/evergreen/vsl/bunny/route.ts', import.meta.url), 'utf8')
const cliente = readFileSync(new URL('../components/vsl/subirABunny.ts', import.meta.url), 'utf8')

test('la firma sigue el orden documentado por Bunny: library + key + expiración + vídeo', () => {
  // bunny.net/docs/stream/tus-resumable-uploads: SHA256(library_id + api_key + expiration_time + video_id)
  const esperada = createHash('sha256')
    .update('123' + 'clave' + '1700000000' + 'vid-1')
    .digest('hex')
  assert.equal(firmaSubidaBunny('123', 'clave', 1700000000, 'vid-1'), esperada)
  // Cambiar cualquier pieza cambia la firma: no sirve para otro vídeo ni con otra caducidad.
  assert.notEqual(firmaSubidaBunny('123', 'clave', 1700000000, 'vid-2'), esperada)
  assert.notEqual(firmaSubidaBunny('123', 'clave', 1700000001, 'vid-1'), esperada)
})

test('el hostname se limpia como lo pegue la gente', () => {
  for (const entrada of [
    'vz-abc123-456.b-cdn.net',
    'https://vz-abc123-456.b-cdn.net',
    'https://vz-abc123-456.b-cdn.net/',
    '  VZ-ABC123-456.b-cdn.net  ',
    'https://vz-abc123-456.b-cdn.net/xyz/playlist.m3u8',
  ]) {
    assert.equal(normalizarHostBunny(entrada), 'vz-abc123-456.b-cdn.net', `falló con "${entrada}"`)
  }
  for (const malo of ['', null, undefined, 'no es un host', 'https://']) {
    assert.equal(normalizarHostBunny(malo), null)
  }
})

test('las URLs de reproducción siguen la estructura de Bunny', () => {
  const u = urlsVideoBunny('vz-x.b-cdn.net', 'vid-1')
  assert.equal(u.playlist, 'https://vz-x.b-cdn.net/vid-1/playlist.m3u8')
  assert.equal(u.miniatura, 'https://vz-x.b-cdn.net/vid-1/thumbnail.jpg')
})

test('una configuración incompleta dice qué falta, en palabras de la pantalla', () => {
  assert.deepEqual(faltaEnConfigBunny({}), [
    'el ID de la biblioteca',
    'la API key de la biblioteca',
    'el hostname de la CDN',
  ])
  assert.equal(configBunny({ BUNNY_STREAM_LIBRARY_ID: '1', BUNNY_STREAM_API_KEY: 'k' }), null)
  assert.deepEqual(
    configBunny({
      BUNNY_STREAM_LIBRARY_ID: ' 1 ',
      BUNNY_STREAM_API_KEY: 'k',
      BUNNY_STREAM_CDN_HOSTNAME: 'https://h.b-cdn.net/',
    }),
    { libraryId: '1', apiKey: 'k', cdnHostname: 'h.b-cdn.net' }
  )
})

test('el error de clave apunta a la confusión más común: la key de la cuenta en vez de la de la biblioteca', () => {
  assert.match(causaErrorBunny(401), /BIBLIOTECA/)
  assert.match(causaErrorBunny(404), /ID de la biblioteca/)
})

// ── LA API KEY NO SALE DEL SERVIDOR ──────────────────────────────────────────────────────────

test('la ruta nunca devuelve la API key', () => {
  const respuesta = ruta.slice(ruta.lastIndexOf('return NextResponse.json({'))
  // La clave entra en la firma (un hash, irreversible) y en nada más de la respuesta.
  assert.match(respuesta, /firma: firmaSubidaBunny\(/)
  const sinFirma = respuesta.replace(/firma: firmaSubidaBunny\([^)]*\)/, '')
  assert.doesNotMatch(sinFirma, /apiKey/, 'la respuesta final no puede incluir la API key')
})

test('la ruta exige sesión de la subcuenta antes de leer su configuración', () => {
  for (const metodo of ['GET', 'POST']) {
    const cuerpo = ruta.slice(ruta.indexOf(`export async function ${metodo}`))
    assert.ok(cuerpo.indexOf('requireTenant(') < cuerpo.indexOf('getTenantConfigWithFallback('), metodo)
  }
})

test('el navegador sube directo a Bunny por TUS con la firma, sin conocer la clave', () => {
  assert.match(cliente, /from 'tus-js-client'/)
  for (const h of ['AuthorizationSignature', 'AuthorizationExpire', 'VideoId', 'LibraryId']) {
    assert.match(cliente, new RegExp(`${h}:`), `falta la cabecera ${h}`)
  }
  assert.doesNotMatch(cliente, /AccessKey|BUNNY_STREAM_API_KEY/)
})

// ── INTEGRACIÓN EN EL PANEL ──────────────────────────────────────────────────────────────────

test('Bunny está en Integraciones, con prueba de conexión y la clave como secreto', () => {
  const g = INTEGRATION_GROUPS.find((x) => x.id === 'bunny')
  assert.ok(g, 'falta la integración de Bunny')
  assert.equal(g.test, true)
  assert.equal(g.fields.find((f) => f.key === 'BUNNY_STREAM_API_KEY').secret, true)
  const guia = g.pasos.map((p) => `${p.titulo} ${p.detalle}`).join(' ')
  // Cada campo obligatorio se explica: de dónde sale, en el panel de Bunny.
  for (const texto of ['Video Library ID', 'API Key', 'CDN Hostname']) assert.ok(guia.includes(texto), texto)
  assert.match(guia, /no la de tu cuenta/i, 'la confusión de claves tiene que estar avisada')
})
