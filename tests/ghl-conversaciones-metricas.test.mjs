// Métricas GHL del resumen cross-plataforma (continuación de #283).
//
// Se prueban las dos piezas que deciden el comportamiento en producción:
//   1. `resumir` + `detectarEnlaceAgendaEnMensajes` (agregación COMPARTIDA con Instagram): misma
//      forma de tarjeta para ambas plataformas, tasas sin NaN, señal débil separada de la real.
//   2. `calcularMetricasGhl` con un PostgREST falso (mock de fetch — cada fichero de tests corre en
//      su propio proceso, el override no se filtra a otros): snapshot → vinculación fresca →
//      citas/ventas → resumen; snapshot vacío → null ("abre la pestaña primero"); y el fail-loud:
//      un error de BD en citas/ventas lanza, NUNCA pinta la tarjeta en cero (un hueco no es un cero).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://supafake.local'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'clave-de-test'

import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { detectarEnlaceAgendaEnMensajes, resumir } from '../lib/instagram/conversation-metrics.ts'
import { calcularMetricasGhl } from '../lib/ghl/conversaciones-metricas.ts'

// Cliente REAL de supabase-js contra la URL falsa: sus builders llaman por fetch a /rest/v1/... y
// ahí los intercepta el fetch falso de abajo (igual que hará la ruta en producción).
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

test('resumir: vacío da ceros y tasas 0 (no NaN)', () => {
  const r = resumir([], 0)
  assert.equal(r.totalConversaciones, 0)
  assert.equal(r.conContactoVinculado, 0)
  assert.equal(r.tasaVinculacion, 0)
  assert.equal(r.tasaAgendaSobreVinculados, 0)
  assert.ok(Number.isFinite(r.tasaVinculacion) && Number.isFinite(r.tasaAgendaSobreVinculados))
})

test('resumir: mezcla de vinculadas, agenda, venta y señal débil separada', () => {
  const porConversacion = [
    {
      conversationId: '1',
      matchedContactId: 'ca',
      tieneAgenda: true,
      tieneVenta: true,
      enlaceAgendaEnTexto: false,
      messageCount: 4,
    },
    {
      conversationId: '2',
      matchedContactId: 'cb',
      tieneAgenda: false,
      tieneVenta: false,
      enlaceAgendaEnTexto: false,
      messageCount: 2,
    },
    {
      conversationId: '3',
      matchedContactId: null,
      tieneAgenda: null,
      tieneVenta: null,
      enlaceAgendaEnTexto: true,
      messageCount: 1,
    },
  ]
  const r = resumir(porConversacion, 3)
  assert.equal(r.totalConversaciones, 3)
  assert.equal(r.conContactoVinculado, 2)
  assert.equal(r.conAgendaVerificada, 1)
  assert.equal(r.conVentaVerificada, 1)
  assert.equal(r.sinContactoVinculado, 1)
  assert.equal(r.sinContactoConEnlaceAgenda, 1, 'la señal débil se cuenta aparte, nunca como agenda')
  assert.ok(Math.abs(r.tasaVinculacion - 2 / 3) < 1e-9)
  assert.ok(Math.abs(r.tasaAgendaSobreVinculados - 1 / 2) < 1e-9)
})

test('detectarEnlaceAgendaEnMensajes: Calendly, Cal.com y widget GHL sí; texto plano no', () => {
  assert.equal(detectarEnlaceAgendaEnMensajes([{ text: 'te dejo https://calendly.com/demo/30min' }]), true)
  assert.equal(detectarEnlaceAgendaEnMensajes([{ text: 'reserva en https://cal.com/x' }]), true)
  assert.equal(detectarEnlaceAgendaEnMensajes([{ text: 'https://algo.gohighlevel.com/widget/booking' }]), true)
  assert.equal(detectarEnlaceAgendaEnMensajes([{ text: '¿te viene mañana?' }]), false)
  assert.equal(detectarEnlaceAgendaEnMensajes([{ text: undefined }, {}]), false)
})

// ── PostgREST falso ─────────────────────────────────────────────────────────────────
// supabase-js llama por fetch a /rest/v1/...; respondemos según la tabla. El try/finally de cada
// test restaura el fetch real aunque una aserción falle (sin fugas entre ficheros).
function instalarFetchFalso(handlers) {
  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    for (const [patron, responder] of handlers) {
      if (url.includes(patron)) return responder(url)
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return () => {
    globalThis.fetch = original
  }
}

const snapshotCompleto = {
  guardado: '2026-09-28T18:00:00.000Z',
  conversaciones: [
    { id: 'c1', participant: 'GHL-a', contactId: 'ghl-a', unread_count: 0, message_count: 4, messages: [] },
    { id: 'c2', participant: 'Beto', contact_email: 'B@MAIL.com', unread_count: 1, message_count: 2, messages: [] },
    {
      id: 'c3',
      participant: 'Caro',
      unread_count: 0,
      message_count: 1,
      messages: [
        { from: 'agente', text: 'agendemos: https://calendly.com/demo/30min', created_time: '2026-09-28T10:00:00Z' },
      ],
    },
  ],
}

test('calcularMetricasGhl: snapshot → vinculación fresca → resumen coherente con citas/ventas', async () => {
  const restaurar = instalarFetchFalso([
    [
      '/integration_settings?',
      () =>
        new Response(JSON.stringify({ value: JSON.stringify(snapshotCompleto) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    [
      '/contacts?',
      (url) => {
        if (url.includes('ghl_contact_id=in.'))
          return new Response(
            JSON.stringify([{ id: 'ca', full_name: 'Ana', email: 'ana@x.com', phone: null, ghl_contact_id: 'ghl-a' }]),
            { status: 200 }
          )
        if (url.includes('email=in.'))
          return new Response(
            JSON.stringify([{ id: 'cb', full_name: 'Beto', email: 'b@mail.com', phone: null, ghl_contact_id: null }]),
            { status: 200 }
          )
        return new Response('[]', { status: 200 })
      },
    ],
    ['/appointments?', () => new Response(JSON.stringify([{ contact_id: 'ca' }]), { status: 200 })],
    ['/sales?', () => new Response(JSON.stringify([{ contact_id: 'ca' }]), { status: 200 })],
  ])
  try {
    const r = await calcularMetricasGhl(sb, 'tenant-1')
    assert.ok(r, 'hay snapshot, la tarjeta debe calcularse')
    assert.equal(r.guardado, '2026-09-28T18:00:00.000Z')
    // Vinculación fresca: por ghl_contact_id (c1), por email normalizado (c2), sin match (c3).
    assert.equal(r.porConversacion[0].matchedContactId, 'ca')
    assert.equal(r.porConversacion[1].matchedContactId, 'cb')
    assert.equal(r.porConversacion[2].matchedContactId, null)
    assert.equal(r.porConversacion[2].enlaceAgendaEnTexto, true, 'la señal débil se detecta en la transcripción')
    assert.equal(r.resumen.totalConversaciones, 3)
    assert.equal(r.resumen.conContactoVinculado, 2)
    assert.equal(r.resumen.conAgendaVerificada, 1, 'solo ca tiene cita')
    assert.equal(r.resumen.conVentaVerificada, 1)
    assert.equal(r.resumen.sinContactoConEnlaceAgenda, 1)
  } finally {
    restaurar()
  }
})

test('calcularMetricasGhl: sin snapshot devuelve null ("abre la pestaña primero"), nunca ceros', async () => {
  const restaurar = instalarFetchFalso([
    [
      '/integration_settings?',
      () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }),
    ],
  ])
  try {
    const r = await calcularMetricasGhl(sb, 'tenant-1')
    assert.equal(r, null)
  } finally {
    restaurar()
  }
})

test('calcularMetricasGhl: error de BD leyendo citas lanza (fail-loud), no pinta la tarjeta en cero', async () => {
  const snapshot = {
    guardado: '2026-09-28T18:00:00.000Z',
    conversaciones: [{ id: 'c1', contactId: 'ghl-a', unread_count: 0, message_count: 1, messages: [] }],
  }
  const restaurar = instalarFetchFalso([
    [
      '/integration_settings?',
      () =>
        new Response(JSON.stringify({ value: JSON.stringify(snapshot) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    [
      '/contacts?',
      () =>
        new Response(
          JSON.stringify([{ id: 'ca', full_name: 'Ana', email: 'ana@x.com', phone: null, ghl_contact_id: 'ghl-a' }]),
          { status: 200 }
        ),
    ],
    [
      '/appointments?',
      () =>
        new Response(JSON.stringify({ message: 'permisos insuficientes' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
    ],
  ])
  try {
    await assert.rejects(() => calcularMetricasGhl(sb, 'tenant-1'), /No se pudieron leer las citas/)
  } finally {
    restaurar()
  }
})
