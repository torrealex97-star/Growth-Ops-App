import assert from 'node:assert/strict'
import test from 'node:test'
import { completeText } from '../lib/ai/provider.ts'
import { extractInvoice } from '../lib/ai/claude.ts'
import { GROQ_VISION_MODELOS } from '../lib/ai/groq.ts'

// EL CONTRATO. Todas las funciones de IA funcionan con el motor que la subcuenta tenga conectado:
// los modelos más potentes atienden las tareas estratégicas y los ligeros las sencillas, y si solo
// hay UN motor conectado, ese toma el relevo de todo. Lo que no puede pasar es un error "falta
// Anthropic" cuando hay otra IA conectada.
//
// Esta suite no toca la red: sustituye fetch global y comprueba QUÉ motor se llama, con QUÉ formato
// y QUÉ pasa cuando uno falla o no está.

const jsonResp = (data) => ({ ok: true, status: 200, json: async () => data })

function conFetch(falso) {
  const original = globalThis.fetch
  globalThis.fetch = falso
  return () => {
    globalThis.fetch = original
  }
}

const GROQ_MODELOS = { data: [{ id: 'llama-3.1-8b-instant' }, { id: 'llama-3.3-70b-versatile' }] }

test('con solo Groq conectada, las tareas de texto se atienden con Groq (sin error por falta de Anthropic)', async () => {
  const cuerpos = []
  const restaurar = conFetch(async (url, init) => {
    if (String(url).includes('/models')) return jsonResp(GROQ_MODELOS)
    assert.match(String(url), /api\.groq\.com\/openai\/v1\/chat\/completions/)
    cuerpos.push(JSON.parse(init.body))
    return jsonResp({ choices: [{ message: { content: 'texto servido' } }] })
  })
  try {
    const r = await completeText({ system: 's', user: 'u', maxTokens: 100, smart: true }, { GROQ_API_KEY: 'gq_test' })
    assert.equal(r.engine, 'groq')
    assert.equal(r.text, 'texto servido')
    assert.equal(r.fallbackReason, undefined)
    // Tarea estratégica → el modelo grande disponible, no el rápido.
    assert.equal(cuerpos[0].model, 'llama-3.3-70b-versatile')
  } finally {
    restaurar()
  }
})

test('la tarea sencilla pide el modelo rápido y la estratégica el grande (niveles de potencia)', async () => {
  const modelos = []
  const restaurar = conFetch(async (url, init) => {
    if (String(url).includes('/models')) return jsonResp(GROQ_MODELOS)
    modelos.push(JSON.parse(init.body).model)
    return jsonResp({ choices: [{ message: { content: 'ok' } }] })
  })
  try {
    const env = { GROQ_API_KEY: 'gq_test' }
    await completeText({ system: 's', user: 'u', maxTokens: 10 }, env)
    await completeText({ system: 's', user: 'u', maxTokens: 10, smart: true }, env)
    assert.deepEqual(modelos, ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'])
  } finally {
    restaurar()
  }
})

test('si el motor preferido falla, el siguiente conectado toma el relevo y el relevo se declara', async () => {
  const restaurar = conFetch(async (url, init) => {
    if (String(url).includes('api.deepseek.com')) {
      return { ok: false, status: 500, json: async () => ({ error: { message: 'boom deepseek' } }) }
    }
    if (String(url).includes('/models')) return jsonResp(GROQ_MODELOS)
    return jsonResp({ choices: [{ message: { content: 'servido por groq' } }] })
  })
  try {
    const r = await completeText(
      { system: 's', user: 'u', maxTokens: 10 },
      { DEEPSEEK_API_KEY: 'dk', GROQ_API_KEY: 'gq' }
    )
    assert.equal(r.engine, 'groq')
    assert.match(r.fallbackReason, /deepseek: boom deepseek/)
  } finally {
    restaurar()
  }
})

test('sin ningún motor conectado se dice qué conectar, no un error críptico del SDK', async () => {
  await assert.rejects(
    () => completeText({ system: 's', user: 'u', maxTokens: 10 }, {}),
    /Configura una clave de DeepSeek, Anthropic o Groq/
  )
})

test('factura en imagen sin ningún motor con visión: error accionable, nunca una extracción inventada', async () => {
  let llamadas = 0
  const restaurar = conFetch(async () => {
    llamadas++
    throw new Error('no debería llamarse: un modelo de texto no ve la imagen')
  })
  try {
    await assert.rejects(
      () => extractInvoice('aGVsbG8=', 'image/png', [], { DEEPSEEK_API_KEY: 'dk' }),
      /motor con visión/
    )
    assert.equal(llamadas, 0, 'la imagen se mandó a algún motor de texto')
  } finally {
    restaurar()
  }
})

test('factura en imagen con solo Groq: se lee con el modelo de visión, la imagen en data URI y JSON mode', async () => {
  const cuerpos = []
  const restaurar = conFetch(async (url, init) => {
    cuerpos.push(JSON.parse(init.body))
    return jsonResp({ choices: [{ message: { content: '{"concept":"Publicidad","amount":10,"confidence":0.9}' } }] })
  })
  try {
    const out = await extractInvoice('aGVsbG8=', 'image/png', [], { GROQ_API_KEY: 'gq' })
    assert.equal(out.concept, 'Publicidad')
    const body = cuerpos[0]
    assert.equal(body.model, GROQ_VISION_MODELOS[0])
    const parte = body.messages[1].content.find((c) => c.type === 'image_url')
    assert.match(parte.image_url.url, /^data:image\/png;base64,aGVsbG8=/)
    assert.deepEqual(body.response_format, { type: 'json_object' })
  } finally {
    restaurar()
  }
})

test('si Groq retiró el primer modelo de visión, se prueba el siguiente en vez de fallar', async () => {
  const usados = []
  const restaurar = conFetch(async (url, init) => {
    const body = JSON.parse(init.body)
    usados.push(body.model)
    if (usados.length === 1) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 'model_not_found', message: `The model ${body.model} does not exist` } }),
      }
    }
    return jsonResp({ choices: [{ message: { content: '{"concept":"Ok"}' } }] })
  })
  try {
    const out = await extractInvoice('aGVsbG8=', 'image/jpeg', [], { GROQ_API_KEY: 'gq' })
    assert.equal(out.concept, 'Ok')
    assert.deepEqual(usados, [GROQ_VISION_MODELOS[0], GROQ_VISION_MODELOS[1]])
  } finally {
    restaurar()
  }
})

test('factura PDF con solo DeepSeek: se extrae el texto del documento y lo analiza el motor de texto', async () => {
  const restaurar = conFetch(async (url, init) => {
    assert.match(String(url), /api\.deepseek\.com/)
    const body = JSON.parse(init.body)
    const user = body.messages.at(-1).content
    assert.match(user, /Factura:/)
    // El binario del PDF nunca viaja a un modelo de texto: viaja su texto extraído.
    assert.doesNotMatch(user, /data:application\/pdf/)
    return jsonResp({ choices: [{ message: { content: '{"concept":"Software","amount":30,"confidence":0.8}' } }] })
  })
  try {
    const out = await extractInvoice(
      'aGVsbG8=',
      'application/pdf',
      [],
      { DEEPSEEK_API_KEY: 'dk' },
      { extraerTextoPdf: async () => 'FACTURA ACME S.L.\nCIF B12345678\nTotal: 30,00 EUR' }
    )
    assert.equal(out.amount, 30)
  } finally {
    restaurar()
  }
})

test('PDF escaneado sin capa de texto: error honesto pidiendo imagen, sin inventar datos', async () => {
  await assert.rejects(
    () => extractInvoice('aGVsbG8=', 'application/pdf', [], {}, { extraerTextoPdf: async () => '   ' }),
    /capa de texto/
  )
})
