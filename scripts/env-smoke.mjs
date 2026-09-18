import { readFileSync } from 'node:fs'

// Smoke test de las env vars restauradas — NO imprime ningún valor secreto.
// 1) /api/track/[site] con clave INCORRECTA  → 401 (rechazo)
// 2) /api/track/[site] con clave CORRECTA + body vacío → 400 "JSON inválido"
//    (pasa la autenticación: la clave restaurada se compara y coincide)
// 3) webhooks/ghl con x-ghl-secret INCORRECTO → 401 (fail-closed)
// 4) webhooks/ghl con x-ghl-secret CORRECTO + body vacío → pasa auth (respuesta ≠ 401)
const base = 'http://localhost:3000'
const env = Object.fromEntries(
  readFileSync('/tmp/growthops-preview/.env.local', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=.+/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const j = async (r) => {
  try {
    return await r.json()
  } catch {
    return null
  }
}

// 1) ruta legacy de ingesta con clave INCORRECTA → 401 (rechazo)
const bad = await fetch(`${base}/api/women-digital-closer/evergreen/tracking/events`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer clave-erronea' },
  body: JSON.stringify({ event: 'page_view' }),
})
console.log('1) ingest clave INCORRECTA     →', bad.status, (await j(bad))?.error || '')

// 2) ruta legacy con clave CORRECTA: pasa auth y falla en validación JSON (body vacío)
const good = await fetch(`${base}/api/women-digital-closer/evergreen/tracking/events`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TRACKING_INGEST_KEY}` },
  body: '',
})
const g = await j(good)
console.log('2) ingest clave CORRECTA (auth) →', good.status, g?.error || '')
console.log('   ¿pasó autenticación?:', good.status !== 401 ? 'SÍ (fallo posterior = validación/tenant)' : 'NO')

// 3) GHL con secreto incorrecto
const ghlBad = await fetch(`${base}/api/women-digital-closer/evergreen/webhooks/ghl`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-ghl-secret': 'incorrecto' },
  body: JSON.stringify({}),
})
console.log('3) GHL secreto INCORRECTO      →', ghlBad.status, (await j(ghlBad))?.error || '')

// 4) GHL con el secreto restaurado: debe pasar auth (cualquier respuesta ≠ 401)
const ghlGood = await fetch(`${base}/api/women-digital-closer/evergreen/webhooks/ghl`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-ghl-secret': env.GHL_WEBHOOK_SECRET },
  body: JSON.stringify({}),
})
const gg = await j(ghlGood)
console.log('4) GHL secreto CORRECTO (auth) →', ghlGood.status, (gg?.error || '').slice(0, 80))
console.log('   ¿pasó autenticación?:', ghlGood.status !== 401 ? 'SÍ' : 'NO')
