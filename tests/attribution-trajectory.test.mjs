import assert from 'node:assert/strict'
import test from 'node:test'
import { leerTrayectoria, serializarToque } from '../lib/contacts/atribucion.ts'

test('GHL: normaliza first y last anidados con UTMs, click ids, GA y anuncio', () => {
  const result = leerTrayectoria({
    attributionSource: {
      utmSource: 'facebook',
      utmMedium: 'paid_social',
      utmCampaign: 'webinar',
      gclid: 'g-first',
      gaClientId: 'ga-client',
      adId: 'ad-1',
      url: 'https://example.com/landing',
      ip: '192.0.2.1',
      userAgent: 'not-persisted',
    },
    lastAttributionSource: {
      utmSource: 'email',
      utmContent: 'reminder-2',
      gaSessionId: 'ga-session',
      referrer: 'https://mail.example',
    },
  })

  assert.equal(result.first?.utmSource, 'facebook')
  assert.equal(result.first?.gclid, 'g-first')
  assert.equal(result.first?.gaClientId, 'ga-client')
  assert.equal(result.first?.adId, 'ad-1')
  assert.equal(result.last?.utmSource, 'email')
  assert.equal(result.last?.gaSessionId, 'ga-session')
  assert.equal(result.second, null, 'last-touch no se puede renombrar como second-touch')
  assert.deepEqual(serializarToque(result.first)?.ip, undefined)
  assert.deepEqual(serializarToque(result.first)?.userAgent, undefined)
})

test('solo acepta second-touch cuando el proveedor entrega una segunda interacción explícita', () => {
  const result = leerTrayectoria({
    attributionSource: { utmSource: 'meta' },
    secondAttributionSource: { utmSource: 'youtube', utmCampaign: 'retargeting' },
    lastAttributionSource: { utmSource: 'email' },
  })
  assert.equal(result.second?.utmSource, 'youtube')
  assert.equal(result.second?.utmCampaign, 'retargeting')
})

test('Calendly: tracking es evidencia de booking, no first ni second inventados', () => {
  const result = leerTrayectoria({
    tracking: {
      utm_source: 'instagram',
      utm_medium: 'organic_social',
      utm_campaign: 'reel-octubre',
      utm_content: 'reel-42',
      utm_term: 'closer-claudia',
    },
  })
  assert.equal(result.booking?.utmSource, 'instagram')
  assert.equal(result.booking?.utmTerm, 'closer-claudia')
  assert.equal(result.first, null)
  assert.equal(result.second, null)
  assert.equal(result.last, null)
})

test('payload plano legacy sigue siendo compatible y captura IDs modernos', () => {
  const result = leerTrayectoria({
    utm_source: 'google',
    utm_id: 'campaign-123',
    utm_source_platform: 'google_ads',
    gbraid: 'gbraid-1',
    wbraid: 'wbraid-1',
    msclkid: 'ms-1',
  })
  assert.equal(result.booking?.utmId, 'campaign-123')
  assert.equal(result.booking?.gbraid, 'gbraid-1')
  assert.equal(result.booking?.wbraid, 'wbraid-1')
  assert.equal(result.booking?.msclkid, 'ms-1')
})
