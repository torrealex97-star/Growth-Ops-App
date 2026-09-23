import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

const claude = await readFile('lib/ai/claude.ts', 'utf8')
const invoiceRoute = await readFile('app/api/[tenant]/evergreen/ai/invoice/route.ts', 'utf8')
const migration = await readFile('supabase/migrations/20260922100000_invoice_ai_identity_traceability.sql', 'utf8')
const gastos = await readFile('app/[tenant]/finanzas/gastos-facturas/gastos/page.tsx', 'utf8')

test('la extracción IA incluye identidad legal y datos bancarios del emisor', () => {
  for (const field of [
    'counterparty_tax_id',
    'counterparty_address',
    'counterparty_bank_account',
    'counterparty_bank_name',
    'invoice_number',
    'invoice_due_date',
  ]) {
    assert.match(claude, new RegExp(field))
    assert.match(gastos, new RegExp(field))
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${field}`))
  }
})

test('la cuenta propia y el pago no se inventan a partir de la factura', () => {
  assert.match(claude, /NO demuestra que el pago se haya realizado/)
  assert.match(claude, /No extraigas datos de la cuenta propia/)
  assert.match(gastos, /paid_from_account/)
  // El pago no se inventa: solo se fija paid_at cuando el usuario marca el gasto como 'pagado'.
  assert.match(gastos, /paid_at: ne\.status === 'pagado'/)
  assert.match(gastos, /paid_at: next === 'pagado'/)
})

test('la ruta mantiene revisión humana antes de confirmar', () => {
  assert.match(invoiceRoute, /needs_review/)
  assert.match(gastos, /Datos extraídos con IA — revisa antes de crear/)
})
