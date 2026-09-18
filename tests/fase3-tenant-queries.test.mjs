// FASE 3 (multitenant) — barrera anti-regresión.
//
// Regla: en código que consulta con service_role (RLS bypaseado), toda query a una tabla
// con tenant_id debe llevar el filtro explícito cerca del chain. El escáner
// (scripts/auditoria-tenant-queries.mjs) produce CANDIDATOS — heurística de ventanas de
// texto, no prueba formal — y este test exige que la lista esté VACÍA.
//
// Si este test falla al tocar código nuevo:
//   1. Si tu query realmente consulta una tabla con tenant_id sin filtrarlo con
//      service_role, ES UNA FUGA: añade `.eq('tenant_id', tenantId)` (o estampa la columna
//      en el insert/update) antes de "arreglar" el test.
//   2. Si es un falso positivo del escáner (p. ej. la mención está a >1500 chars o dentro
//      de un helper), amplía la ventana o trata el caso en el escáner, y documenta por qué.
// No amplíes la lista de excepciones sin auditoría: cada excepción es una fuga aceptada.

import assert from 'node:assert/strict'
import test from 'node:test'
import { escanear } from '../scripts/auditoria-tenant-queries.mjs'

test('fase 3: ninguna query service-role a tabla con tenant_id queda sin filtro', () => {
  const { resumen, candidatos } = escanear()

  // Sanity del propio escáner: si el barrido se queda a cero, el test no dice nada.
  assert.ok(resumen.rutasService >= 100, `rutas service-role inesperadamente pocas (${resumen.rutasService})`)
  assert.ok(
    resumen.queriesServiceRevisadas >= 400,
    `queries revisadas inesperadamente pocas (${resumen.queriesServiceRevisadas})`
  )

  assert.deepEqual(
    candidatos,
    [],
    `candidatos a fuga cross-tenant (revisar y filtrar por tenant_id, o justificar en el escáner):\n  ${candidatos.map((c) => `${c.fichero}:${c.linea} → ${c.tabla}`).join('\n  ')}`
  )
})
