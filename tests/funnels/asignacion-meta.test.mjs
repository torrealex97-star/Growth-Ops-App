// La asignación MANUAL (campaign_funnel_assignments) filtra las etapas Meta de cada familia.
// Se prueba la lógica pura replicando el patrón de loadFunnelCounts (el módulo importa el cliente
// de Supabase y no es importable directo desde tests .mjs).
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const src = readFileSync(join(root, 'lib/funnels/queries.ts'), 'utf8')

test('el motor mapea cada familia a su tipo de asignación y web_seo no filtra', () => {
  assert.match(src, /vsl: 'vsl'/)
  assert.match(src, /webinar: 'webinar'/)
  assert.match(src, /profile: 'dm'/)
  // web_seo NO aparece en el mapa: es orgánico, sus etapas Meta no existen y GA4 no se filtra.
  const bloque = src.match(/const FAMILIA_A_ASIGNACION[^}]+\}/)?.[0] || ''
  assert.ok(!bloque.includes('web_seo'), 'web_seo no debe filtrar por asignaciones')
})

test('metaStages filtra campaign_daily SOLO con asignaciones existentes; sin asignar mantiene el total', () => {
  // El filtro por ids debe ser condicional: null (nadie asignó) NO puede colapsar el funnel a 0.
  assert.match(src, /if \(ids\) q = q\.in\('campaign_id', ids\)/)
  // Y el comentario de la regla de negocio debe acompañar al código (error ≠ vacío).
  assert.match(src, /Sin asignaci[oó]n \(null\) se mantiene el total del tenant/)
})

test('la lectura de asignaciones es tolerante a fallo y a tabla ausente', () => {
  // campanasAsignadas devuelve null en error (degrada a total del tenant, nunca rompe el funnel).
  assert.match(src, /async function campanasAsignadas[\s\S]*?catch [\s\S]*?return null/)
  assert.match(src, /if \(error\) return null/)
})

test('metaSafe pide las asignaciones antes de calcular las etapas Meta', () => {
  assert.match(src, /const ids = await campanasAsignadas\(sb, tenantId, family\)/)
  assert.match(src, /metaStages\(sb, tenantId, range, ids\)/)
})
