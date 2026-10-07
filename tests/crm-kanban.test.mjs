import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync('app/[tenant]/crm/seguimiento/page.tsx', 'utf8')
const route = readFileSync('app/api/[tenant]/evergreen/appointments/followup-stage/route.ts', 'utf8')

test('el Kanban permite mover oportunidades con drag and drop y con un control accesible', () => {
  assert.match(page, /draggable=\{canChangeStatus && savingStageId !== a\.id\}/)
  assert.match(page, /onDrop=\{\(event\) =>/)
  assert.match(page, /handleKanbanDrop\(stage\)/)
  assert.match(page, /aria-label=\{`Mover \$\{a\.contacts\?\.full_name \|\| 'contacto'\} a otra etapa`\}/)
  assert.match(page, /<Select[\s\S]*?handleFollowupStageChange\(/)
})

test('el movimiento reutiliza la persistencia optimista y revierte ante un fallo', () => {
  assert.match(page, /fetch\(`\/api\/\$\{tenant\}\/evergreen\/appointments\/followup-stage`/)
  assert.match(page, /followup_stage: prevStage, notes: prevNotes/)
  assert.match(page, /toast\.error\('Error al actualizar la etapa'/)
})

test('el endpoint impide mover una agenda de otra subcuenta o fuera del alcance del usuario', () => {
  assert.match(route, /\.eq\('tenant_id', t\.tenantId\)/)
  assert.match(route, /appt\.setter_id !== t\.userId && appt\.closer_id !== t\.userId/)
  assert.match(route, /Solo puedes gestionar tus propias agendas/)
})
