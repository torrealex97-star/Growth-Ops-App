import assert from 'node:assert/strict'
import test from 'node:test'
import { categorizeByMime, isAcceptedMime } from '../../lib/recordings/categorize.ts'
import { deriveCallOutcome } from '../../lib/recordings/outcome.ts'

const input = (over = {}) => ({
  appointmentStatus: 'show',
  followupStage: null,
  linkedSales: [],
  ...over,
})

// ── Resultado de la llamada: SOLO de datos canónicos ───────────────────────
test('una venta activa atada a la cita es una llamada ganada', () => {
  assert.equal(deriveCallOutcome(input({ linkedSales: [{ status: 'active' }] })), 'ganada')
  // partial_refund sigue siendo venta activa: el criterio es el mismo que en el resto de la app.
  assert.equal(deriveCallOutcome(input({ linkedSales: [{ status: 'partial_refund' }] })), 'ganada')
})

test('un reembolso o chargeback NO cuentan como llamada ganada', () => {
  for (const status of ['refunded', 'chargeback', 'cancelled']) {
    assert.notEqual(
      deriveCallOutcome(input({ linkedSales: [{ status }] })),
      'ganada',
      `${status} no debería contar como cierre`
    )
  }
})

test('la venta manda sobre el seguimiento, incluso si está cerrado o descualificado', () => {
  // Si hay dinero, la llamada cerró: los campos de seguimiento no pueden desmentirlo.
  assert.equal(
    deriveCallOutcome(input({ followupStage: 'descualificado', linkedSales: [{ status: 'active' }] })),
    'ganada'
  )
})

test('una llamada que no ocurrió no es una llamada perdida', () => {
  // Mezclar no_show con "perdida" falsearía la tasa de cierre: son cosas distintas.
  for (const status of ['no_show', 'cancelled', 'cancelled_lead', 'rescheduled', 'scheduled', 'seguimiento']) {
    assert.equal(deriveCallOutcome(input({ appointmentStatus: status })), 'no_ocurrio', status)
  }
})

test("'completed' y 'confirmed' no garantizan que la llamada ocurriera", () => {
  // Son estados de las integraciones externas, no una confirmación de asistencia.
  assert.equal(deriveCallOutcome(input({ appointmentStatus: 'completed' })), 'no_ocurrio')
  assert.equal(deriveCallOutcome(input({ appointmentStatus: 'confirmed' })), 'no_ocurrio')
})

test('ocurrió, sin venta y con el seguimiento cerrado => perdida', () => {
  assert.equal(deriveCallOutcome(input({ followupStage: 'cerrado' })), 'perdida')
  assert.equal(deriveCallOutcome(input({ followupStage: 'descualificado' })), 'perdida')
})

test('ocurrió, sin venta y con el seguimiento vivo => pendiente, no perdida', () => {
  // No se da por perdida por el paso del tiempo: eso es una decisión comercial, no un hecho.
  for (const stage of [null, 'pendiente_recontacto', 'en_seguimiento_pago', 'reagendado_pendiente']) {
    assert.equal(deriveCallOutcome(input({ followupStage: stage })), 'pendiente', String(stage))
  }
})

// ── Categoría por MIME, nunca por IA ni por extensión ──────────────────────
test('la categoría sale del MIME y admite parámetros', () => {
  assert.equal(categorizeByMime('audio/mpeg'), 'audio')
  assert.equal(categorizeByMime('video/mp4'), 'video')
  assert.equal(categorizeByMime('video/webm; codecs="vp9"'), 'video')
  assert.equal(categorizeByMime('TEXT/VTT'), 'transcripcion')
  assert.equal(categorizeByMime('application/pdf'), 'documento')
})

test('lo que no está permitido se rechaza, no se guarda por si acaso', () => {
  for (const mime of ['application/x-msdownload', 'application/zip', 'image/png', '', null, undefined, '   ']) {
    assert.equal(categorizeByMime(mime), null, String(mime))
    assert.equal(isAcceptedMime(mime), false, String(mime))
  }
})
