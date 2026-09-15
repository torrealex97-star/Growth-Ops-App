import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const form = readFileSync(join(root, 'components/settings/GrowthContextForm.tsx'), 'utf8')
const company = readFileSync(join(root, 'app/[tenant]/settings/empresa/page.tsx'), 'utf8')
const route = readFileSync(join(root, 'app/api/[tenant]/evergreen/ai/contexto/route.ts'), 'utf8')
const loader = readFileSync(join(root, 'lib/ai/agent/contexto.ts'), 'utf8')

const camposPersistidos = [
  'business_type',
  'offer_name',
  'offer_price_eur',
  'sales_cycle_days',
  'target_monthly_revenue_eur',
  'target_ltgp_cac',
  'target_cash_roas',
  'capacity_calls_per_week',
  'capacity_active_clients',
  'notes',
]

test('la configuración general monta el formulario estratégico existente', () => {
  assert.match(company, /import \{ GrowthContextForm \}/)
  assert.match(company, /<GrowthContextForm \/>/)
})

test('todos los campos de growth_context son editables sin inventar valores', () => {
  for (const campo of camposPersistidos) assert.match(form, new RegExp(campo))
  assert.match(form, /value\.trim\(\) === '' \? null/)
  assert.match(form, /Un campo vacío se trata como “sin configurar”, nunca[\s\S]*como cero/)
})

test('la lectura pide solo las columnas de contexto que consume', () => {
  assert.doesNotMatch(loader, /select\('\*'\)/)
  for (const campo of camposPersistidos) assert.match(loader, new RegExp(campo))
})

test('carga y guardado usan la petición canónica con timeout y errores visibles', () => {
  assert.match(form, /import \{ esFalloVisible, pedir, type Fallo \}/)
  assert.match(form, /pedir<Respuesta>\(`\/api\/\$\{tenant\}\/evergreen\/ai\/contexto`/)
  assert.match(form, /method: 'PUT'/)
  assert.match(form, /finally \{[\s\S]*setGuardando\(false\)/)
  assert.match(form, /onReintentar=/)
})

test('solo dirección edita, incluido el super_admin de plataforma', () => {
  assert.match(route, /puedeEditar: auth\.isSuperAdmin \|\| ROLES_ESCRITURA\.includes/)
  assert.match(form, /disabled=\{!puedeEditar\}/)
  assert.match(form, /Solo dirección puede modificarlos/)
})

test('los campos tienen labels y restricciones coherentes con el servidor', () => {
  assert.match(form, /htmlFor="growth-business-type"/)
  assert.match(form, /id="growth-business-type"/)
  assert.match(form, /maxLength=\{2000\}/)
  assert.match(form, /max="1000000"/)
  assert.match(form, /max="3650"/)
})
