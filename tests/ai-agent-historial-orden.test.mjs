import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// REGRESIÓN — historial del agente de IA (informe FASE A, 26-sep, hallazgo P2 #10).
//
// `order('created_at', { ascending: true }).limit(MAX_HISTORY)` trae los MAX_HISTORY mensajes
// MÁS ANTIGUOS de la conversación, no los recientes: en cualquier conversación con más de
// MAX_HISTORY mensajes, el modelo perdía el contexto justo del turno que el usuario acaba de
// escribir y seguía razonando sobre el arranque de la charla. Estilo de la casa: invariante
// estático sobre el código fuente.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(root, 'app/api/[tenant]/evergreen/ai/agent/route.ts'), 'utf8').replace(/\/\/[^\n]*/g, '')

test('el historial se pide en orden DESCENDENTE (los últimos N), nunca ascendente con límite', () => {
  const bloque = src.slice(src.indexOf("from('ai_messages')"), src.indexOf('insert({ tenant_id: auth.tenantId'))
  assert.match(bloque, /order\('created_at',\s*\{\s*ascending:\s*false\s*\}\)/)
  assert.doesNotMatch(
    bloque,
    /order\('created_at',\s*\{\s*ascending:\s*true\s*\}\)[\s\S]*?\.limit\(/,
    'ascending:true + limit trae los mensajes más VIEJOS, no los recientes'
  )
})

test('el resultado descendente se revierte antes de mandarlo al modelo (orden cronológico)', () => {
  assert.match(src, /priorMessagesDesc[\s\S]{0,80}\.reverse\(\)/)
})
