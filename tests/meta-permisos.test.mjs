import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { AMBITOS_META, ambitosObligatorios, resumirAmbitos } from '../lib/meta/permisos.ts'
import { graphUrl, GRAPH_BASE, isDeprecatedMetaVersion, META_API_VERSION } from '../lib/meta/api-version.ts'
import { inspeccionarToken, interpretarDebugToken, noCaduca } from '../lib/meta/token.ts'
import { veredictoDeToken } from '../lib/meta/token-salud.ts'

// LA APP DE META: 14 PERMISOS CONCEDIDOS, ¿CUÁNTOS SE USAN DE VERDAD?
//
// El síntoma era «Sin comprobar» y «Conectada pero sin sincronizar» en casi todo, y parecía falta de
// implementación. Era un token de usuario de corta duración que murió (código 190), y nadie guardaba el
// veredicto. Estos tests fijan el inventario y la forma en que se explica un token.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

const LOS_14 = [
  'pages_show_list',
  'ads_management',
  'ads_read',
  'business_management',
  'pages_messaging',
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_manage_insights',
  'instagram_content_publish',
  'instagram_manage_messages',
  'pages_read_engagement',
  'pages_manage_metadata',
  'instagram_manage_engagement',
  'public_profile',
]

// ── EL INVENTARIO ────────────────────────────────────────────────────────────────────────────

test('la matriz cubre exactamente los 14 ámbitos del token, cada uno una vez', () => {
  assert.deepEqual(AMBITOS_META.map((a) => a.ambito).sort(), [...LOS_14].sort())
})

test('todo lo que se declara «en uso» tiene una llamada real en el código', () => {
  // Si alguien borra la llamada, el inventario dejaría de decir la verdad en silencio.
  for (const a of AMBITOS_META.filter((x) => x.estado === 'en_uso')) {
    assert.ok(a.evidencia, `${a.ambito}: «en uso» sin evidencia`)
    const src = leer(a.evidencia.fichero)
    assert.ok(
      src.includes(a.evidencia.fragmento),
      `${a.ambito}: ${a.evidencia.fichero} ya no contiene «${a.evidencia.fragmento}»`
    )
  }
})

test('las escrituras sobre cuentas de un cliente NO están implementadas ni se declaran en uso', () => {
  // Publicar, responder, enviar o tocar campañas actúa en público sobre la marca de un cliente: se
  // implementan con decisión explícita y auditoría, no porque el permiso ya esté concedido.
  const sinUso = AMBITOS_META.filter((a) => a.estado === 'concedido_sin_uso').map((a) => a.ambito)
  for (const esperado of [
    'instagram_content_publish',
    'ads_management',
    'instagram_manage_comments',
    'pages_manage_metadata',
  ]) {
    assert.ok(sinUso.includes(esperado), `${esperado} debería constar sin uso`)
  }
  const codigo = ['lib/instagram/client.ts', 'lib/meta/client.ts'].map(leer).join('\n')
  assert.ok(!/media_publish/.test(codigo), 'hay una llamada de publicación que el inventario no declara')
  assert.ok(!/method:\s*'POST'/.test(codigo), 'hay una escritura hacia Meta que el inventario no declara')
})

test('«comentarios» es solo un contador, no lectura de comentarios', () => {
  // Una búsqueda de «comments» da falsos positivos: `comments_count` y la métrica de insights.
  const ig = leer('lib/instagram/client.ts')
  assert.ok(!/\/comments\?|\/comments`|\/comments'/.test(ig), 'ahora sí se leen comentarios: actualiza la matriz')
  assert.equal(AMBITOS_META.find((a) => a.ambito === 'instagram_manage_comments').estado, 'concedido_sin_uso')
})

test('qué exige cada integración, y qué permisos opcionales faltan', () => {
  assert.deepEqual(ambitosObligatorios('meta'), ['ads_read'])
  assert.deepEqual(ambitosObligatorios('instagram').sort(), [
    'instagram_basic',
    'instagram_manage_insights',
    'pages_read_engagement',
    'pages_show_list',
  ])
  const r = resumirAmbitos(['ads_read', 'public_profile'], 'instagram')
  assert.deepEqual(r.faltanObligatorios.sort(), [
    'instagram_basic',
    'instagram_manage_insights',
    'pages_read_engagement',
    'pages_show_list',
  ])
  assert.deepEqual(resumirAmbitos([...LOS_14], 'meta').faltanObligatorios, [])
  assert.deepEqual(resumirAmbitos(['ads_read', 'permiso_nuevo_de_meta'], 'meta').desconocidos, [
    'permiso_nuevo_de_meta',
  ])
})

// ── LA VERSIÓN DE LA API ─────────────────────────────────────────────────────────────────────

test('la URL base y la versión se definen una sola vez', () => {
  assert.equal(graphUrl('v25.0', '/me/accounts'), `${GRAPH_BASE}/v25.0/me/accounts`)
  assert.equal(graphUrl('v25.0/', 'act_1'), `${GRAPH_BASE}/v25.0/act_1`)
  function ficheros(dir, acc = []) {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const rel = join(dir, e.name)
      if (e.isDirectory()) ficheros(rel, acc)
      else if (/\.(ts|tsx)$/.test(e.name)) acc.push(rel)
    }
    return acc
  }
  const dispersos = [...ficheros('app'), ...ficheros('lib'), ...ficheros('components')]
    .filter((f) => f !== 'lib/meta/api-version.ts')
    .filter((f) => /graph\.facebook\.com/.test(leer(f)))
  assert.deepEqual(dispersos, [], 'la URL de la Graph API está escrita a mano fuera de api-version.ts')
})

test('la versión por defecto no está deprecada, y las anteriores a v24 sí lo están', () => {
  assert.equal(isDeprecatedMetaVersion(META_API_VERSION), false)
  for (const v of ['v21.0', 'v22.0', 'v23.0']) assert.equal(isDeprecatedMetaVersion(v), true)
})

// ── INTERPRETAR EL TOKEN ─────────────────────────────────────────────────────────────────────

const AHORA = Date.parse('2026-10-04T10:00:00Z')
const seg = (iso) => Math.floor(Date.parse(iso) / 1000)

test('un token de System User no caduca: expires_at 0', () => {
  const cuerpo = { data: { is_valid: true, type: 'SYSTEM_USER', expires_at: 0, scopes: ['ads_read'] } }
  const info = interpretarDebugToken(cuerpo, AHORA)
  assert.equal(info.tipo, 'system_user')
  assert.equal(info.duradero, true)
  assert.equal(info.caducaEl, null)
  assert.equal(noCaduca(cuerpo), true)
})

test('un token de usuario de corta duración dice cuántas horas le quedan', () => {
  const info = interpretarDebugToken(
    { data: { is_valid: true, type: 'USER', expires_at: seg('2026-10-04T12:00:00Z'), scopes: ['ads_read'] } },
    AHORA
  )
  assert.equal(info.tipo, 'usuario')
  assert.equal(info.horasRestantes, 2)
  assert.equal(noCaduca({ data: { expires_at: seg('2026-10-04T12:00:00Z') } }), false)
})

test('un campo expires_at AUSENTE no se toma por «no caduca»', () => {
  // Prometer que no caduca sin que Meta lo haya dicho es peor que no saberlo.
  assert.equal(noCaduca({ data: { is_valid: true } }), false)
  const info = interpretarDebugToken({ data: { is_valid: true } }, AHORA)
  assert.equal(info.duradero, false, 'sin expires_at no se puede afirmar que no caduque')
  // Y el veredicto no lo presenta como duradero ni inventa una fecha: calla.
  const v = veredictoDeToken({ estado: 'ok', info }, 'meta')
  assert.equal(v.ok, true)
  assert.doesNotMatch(v.mensaje, /no caduca/)
  assert.equal(v.mensaje, '')
})

test('una respuesta sin `data` no se interpreta: null, no un token inventado', () => {
  assert.equal(interpretarDebugToken({ error: { message: 'x' } }), null)
  assert.equal(interpretarDebugToken(null), null)
})

// ── EL VEREDICTO ─────────────────────────────────────────────────────────────────────────────

const ok = (data) => ({ estado: 'ok', info: interpretarDebugToken({ data }, AHORA) })

test('token inválido: se dice por qué y cómo arreglarlo', () => {
  const v = veredictoDeToken(
    ok({ is_valid: false, type: 'USER', expires_at: 1, error: { message: 'La sesión ha caducado' } }),
    'meta'
  )
  assert.equal(v.ok, false)
  assert.equal(v.code, 'token_invalido')
  assert.match(v.mensaje, /System User/)
  assert.match(v.mensaje, /La sesión ha caducado/)
})

test('falta un permiso obligatorio: se nombra el permiso y dónde se marca', () => {
  const v = veredictoDeToken(
    ok({ is_valid: true, type: 'SYSTEM_USER', expires_at: 0, scopes: ['public_profile'] }),
    'meta'
  )
  assert.equal(v.ok, false)
  assert.equal(v.code, 'sin_permisos')
  assert.match(v.mensaje, /ads_read/)
  assert.match(v.mensaje, /Usuarios del sistema/)
})

test('token de usuario que caduca: sigue siendo OK pero avisa antes de que muera', () => {
  const v = veredictoDeToken(
    ok({ is_valid: true, type: 'USER', expires_at: seg('2026-10-04T12:00:00Z'), scopes: ['ads_read'] }),
    'meta'
  )
  assert.equal(v.ok, true, 'avisar de que va a caducar no es una avería')
  assert.match(v.mensaje, /caduca en 2 h/)
  assert.match(v.mensaje, /System User/)
})

test('token que no caduca: lo confirma', () => {
  const v = veredictoDeToken(ok({ is_valid: true, type: 'SYSTEM_USER', expires_at: 0, scopes: ['ads_read'] }), 'meta')
  assert.equal(v.ok, true)
  assert.match(v.mensaje, /no caduca/)
})

test('no poder inspeccionar el token NO empeora el veredicto', () => {
  const v = veredictoDeToken({ estado: 'no_disponible', motivo: 'Meta no respondió' }, 'meta')
  assert.deepEqual(v, { ok: true, mensaje: '' })
})

test('si Meta no lista ámbitos, no se afirma que falten', () => {
  const v = veredictoDeToken(ok({ is_valid: true, type: 'SYSTEM_USER', expires_at: 0, scopes: [] }), 'meta')
  assert.equal(v.ok, true)
})

test('inspeccionar usa el token de aplicación si hay App ID y App Secret, y nunca devuelve el token', async () => {
  let url = ''
  const res = await inspeccionarToken('TOKEN-SECRETO-DE-PRUEBA', {
    appId: '123',
    appSecret: 'abcdef',
    fetchImpl: async (u) => {
      url = String(u)
      return {
        status: 200,
        json: async () => ({ data: { is_valid: true, type: 'SYSTEM_USER', expires_at: 0, scopes: ['ads_read'] } }),
      }
    },
  })
  assert.match(url, /access_token=123%7Cabcdef/, 'debe usar el token de aplicación id|secreto')
  assert.ok(!/appsecret_proof/.test(url), 'con token de aplicación no hace falta firma')
  assert.equal(res.estado, 'ok')
  assert.ok(!JSON.stringify(res).includes('TOKEN-SECRETO-DE-PRUEBA'), 'el token no puede salir en el resultado')
})

test('sin App ID se inspecciona con el propio token y se firma con appsecret_proof', async () => {
  let url = ''
  await inspeccionarToken('tok', {
    appSecret: 'secreto',
    fetchImpl: async (u) => {
      url = String(u)
      return { status: 200, json: async () => ({ data: { is_valid: true } }) }
    },
  })
  assert.match(url, /appsecret_proof=[0-9a-f]{64}/)
})

test('una caída de red al inspeccionar es «no disponible», no una excepción', async () => {
  const res = await inspeccionarToken('tok', {
    fetchImpl: async () => {
      throw new Error('red')
    },
  })
  assert.equal(res.estado, 'no_disponible')
})

// ── EL CABLEADO ──────────────────────────────────────────────────────────────────────────────

test('los crons de Meta e Instagram guardan el veredicto ANTES de sincronizar', () => {
  // Después, una función cortada por tiempo no llegaría a guardarlo y «Sin comprobar» seguiría igual.
  for (const [ruta, grupo, fn] of [
    ['app/api/[tenant]/evergreen/cron/meta/route.ts', 'meta', 'comprobarSaludMeta'],
    ['app/api/[tenant]/evergreen/cron/instagram/route.ts', 'instagram', 'comprobarSaludInstagram'],
  ]) {
    const src = leer(ruta)
    const guardar = src.indexOf(`comprobarYGuardar(sb, tn.id, '${grupo}'`)
    const sincronizar = src.indexOf('recordSyncRun(')
    assert.ok(guardar > 0, `${ruta}: no guarda el veredicto`)
    assert.ok(guardar < sincronizar, `${ruta}: el veredicto debe guardarse antes de sincronizar`)
    assert.match(src, new RegExp(fn))
  }
})

test('la pantalla y los crons comparten la misma comprobación y el mismo guardado', () => {
  const ruta = leer('app/api/[tenant]/evergreen/settings/integraciones/route.ts')
  assert.match(ruta, /comprobarSaludMeta\(cfg\)/)
  assert.match(ruta, /comprobarSaludInstagram\(cfg\)/)
  assert.match(ruta, /guardarComprobacion\(svc\(\), tenantId, group, result\)/)
  assert.ok(!/async function saveLastCheck/.test(ruta), 'el guardado debe vivir en lib/integrations/comprobaciones.ts')
})

test('vercel.json NO programa meta, meta-daily ni instagram: ya van por GitHub Actions', () => {
  // Duplicarlos los ejecutaría dos veces (la A0 documenta que se repartieron SIN solapamiento).
  const vercel = leer('vercel.json')
  for (const job of ['cron/meta"', 'cron/meta-daily', 'cron/instagram']) {
    assert.ok(!vercel.includes(job), `vercel.json programa ${job}: duplicaría el workflow de GitHub`)
  }
  for (const wf of ['cron-meta.yml', 'cron-meta-daily.yml', 'cron-instagram.yml']) {
    assert.ok(readFileSync(join(root, '.github/workflows', wf), 'utf8').includes('schedule:'), `${wf} sin horario`)
  }
})

test('el catálogo recomienda System User y admite el ID de la app', () => {
  const cat = leer('lib/integrations-catalog.ts')
  assert.match(cat, /token de System User/i)
  assert.match(cat, /key: 'META_APP_ID'/)
})
