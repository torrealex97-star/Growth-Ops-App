import assert from 'node:assert/strict'
import test from 'node:test'
import { createHmac } from 'node:crypto'
import { resolveMetaConfigs } from '../../lib/meta/client.ts'

// La config que se GUARDA tiene que ser la config que se USA. Antes estas funciones leían
// process.env, que `ensureConfig` rellena con las credenciales de la última subcuenta atendida por
// la lambda: en el cron que recorre todas las subcuentas, la segunda heredaba el token de la primera
// y se llenaba con SUS campañas, estampadas con su propio tenant_id.

function stubFetch(handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url))
    return handler(String(url), opts, calls.length)
  }
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

const jsonRes = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
})

const cuentas = (ids) => jsonRes({ data: ids.map((id) => ({ id, name: `Cuenta ${id}`, account_status: 1 })) })
const errorMeta = (code, message, status = 400) => jsonRes({ error: { code, message } }, status)

test('sin token la causa es "sin_credenciales", no un error genérico', async () => {
  const f = stubFetch(() => cuentas(['act_1']))
  try {
    await assert.rejects(() => resolveMetaConfigs({}), { code: 'sin_credenciales' })
    assert.equal(f.calls.length, 0, 'no debe llamar a Meta sin token')
  } finally {
    f.restore()
  }
})

test('NO lee las credenciales de process.env: solo usa lo que se le pasa', async () => {
  const previo = process.env.META_ACCESS_TOKEN
  process.env.META_ACCESS_TOKEN = 'token-de-otra-subcuenta'
  const f = stubFetch(() => cuentas(['act_ajena']))
  try {
    await assert.rejects(() => resolveMetaConfigs({}), { code: 'sin_credenciales' })
    assert.equal(f.calls.length, 0)
  } finally {
    f.restore()
    if (previo === undefined) delete process.env.META_ACCESS_TOKEN
    else process.env.META_ACCESS_TOKEN = previo
  }
})

test('con la cuenta elegida a mano, un descubrimiento que falla no impide sincronizar', async () => {
  // El descubrimiento solo sirve para poner el nombre legible: si falla, la cuenta elegida sigue
  // siendo válida y parar aquí dejaría la sync sin hacer por un detalle cosmético.
  const f = stubFetch(() => errorMeta(4, 'rate limit'))
  try {
    const configs = await resolveMetaConfigs({ META_ACCESS_TOKEN: 'tok', META_AD_ACCOUNT_ID: '2204892919779781' })
    assert.equal(configs.length, 1)
    assert.equal(configs[0].accountId, 'act_2204892919779781', 'normaliza el prefijo act_')
    assert.equal(configs[0].accountName, undefined)
  } finally {
    f.restore()
  }
})

test('sin cuenta elegida, el error del token llega arriba en vez de convertirse en "faltan credenciales"', async () => {
  // Este era el fallo que mandaba a revisar un campo perfecto: el token estaba mal (o la firma), y el
  // mensaje hablaba de credenciales que faltaban.
  const f = stubFetch(() => errorMeta(190, 'Invalid OAuth access token', 400))
  try {
    await assert.rejects(() => resolveMetaConfigs({ META_ACCESS_TOKEN: 'tok' }), { code: 'token_invalido' })
  } finally {
    f.restore()
  }
})

test('un token que no ve ninguna cuenta dice exactamente eso', async () => {
  const f = stubFetch(() => cuentas([]))
  try {
    await assert.rejects(() => resolveMetaConfigs({ META_ACCESS_TOKEN: 'tok' }), { code: 'sin_cuentas' })
  } finally {
    f.restore()
  }
})

test('la firma appsecret_proof se calcula sobre el token y el secreto RECORTADOS', async () => {
  // Un espacio pegado al copiar rompía la firma y Meta contestaba "Invalid appsecret_proof" sin decir
  // que sobraba un carácter invisible.
  const f = stubFetch(() => cuentas(['act_9']))
  try {
    await resolveMetaConfigs({ META_ACCESS_TOKEN: '  tok  ', META_APP_SECRET: ' sec \n' })
    const esperada = createHmac('sha256', 'sec').update('tok').digest('hex')
    assert.ok(f.calls[0].includes(`appsecret_proof=${esperada}`), f.calls[0])
  } finally {
    f.restore()
  }
})

test('se reintenta un límite de uso, pero NO un token inválido', async () => {
  // Reintentar un token caducado gasta la ventana del cron y multiplica las peticiones contra el
  // rate limit sin ninguna posibilidad de éxito.
  const limitado = stubFetch((_u, _o, n) => (n < 3 ? errorMeta(4, 'rate limit', 400) : cuentas(['act_1'])))
  try {
    const configs = await resolveMetaConfigs({ META_ACCESS_TOKEN: 'tok' })
    assert.equal(configs.length, 1)
    assert.equal(limitado.calls.length, 3, 'debe reintentar hasta que responda')
  } finally {
    limitado.restore()
  }

  const invalido = stubFetch(() => errorMeta(190, 'Invalid OAuth access token', 400))
  try {
    await assert.rejects(() => resolveMetaConfigs({ META_ACCESS_TOKEN: 'tok' }))
    assert.equal(invalido.calls.length, 1, 'no debe reintentar un fallo de credenciales')
  } finally {
    invalido.restore()
  }
})

test('varias cuentas separadas por comas se sincronizan todas, sin repetidas', async () => {
  const f = stubFetch(() => cuentas(['act_1', 'act_2']))
  try {
    const configs = await resolveMetaConfigs({ META_ACCESS_TOKEN: 'tok', META_AD_ACCOUNT_ID: 'act_1, 1 , act_2' })
    assert.deepEqual(
      configs.map((c) => c.accountId),
      ['act_1', 'act_2']
    )
    assert.equal(configs[0].accountName, 'Cuenta act_1', 'el nombre descubierto se conserva')
  } finally {
    f.restore()
  }
})

test('la versión de la API se toma de la config de la subcuenta', async () => {
  const f = stubFetch(() => cuentas(['act_1']))
  try {
    const configs = await resolveMetaConfigs({ META_ACCESS_TOKEN: 'tok', META_API_VERSION: 'v25.0' })
    assert.equal(configs[0].version, 'v25.0')
    assert.ok(f.calls[0].includes('/v25.0/'), f.calls[0])
  } finally {
    f.restore()
  }
})
