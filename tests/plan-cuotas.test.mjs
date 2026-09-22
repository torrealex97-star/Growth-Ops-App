import assert from 'node:assert/strict'
import test from 'node:test'

import { planCuotasDeVenta } from '../lib/sales/plan-cuotas.ts'

// -----------------------------------------------------------------------------
// PLAN DE CUOTAS DE UNA VENTA (petición del propietario, 22-sep):
// en la ficha de todo contacto debe quedar claro COBRADO vs POR COBRAR con
// fechas: cada cuota en su estado (Cobrada / Por recolectar / Impago), en
// verde al recolectarse y en rojo con el impago hasta que se solucione.
// -----------------------------------------------------------------------------

const coleccionesReales = (cuotas) =>
  cuotas.map((q) => ({
    id: q.id,
    sale_id: 's1',
    expected_installment_id: q.id,
    collected_at: '2026-09-01T10:00:00Z',
    gross_amount: q.expected_gross_amount,
    commissionable_amount: q.expected_commissionable_amount,
    status: 'collected',
    processing_fee: 0,
    extra_fee: 0,
  }))

const metaBase = {
  grossAmount: 1497,
  saleDate: '2026-09-05',
  paymentPlan: { number_of_payments: 1, method: 'pago_unico' },
  installmentsCount: null,
  installmentsStartDate: null,
}

test('calendario REAL: cada cuota en su estado (collected/por recolectar/impago)', () => {
  const hoy = new Date().toISOString().split('T')[0]
  const ayer = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  const enUnMes = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
  const cuotas = [
    {
      id: 'q1',
      sale_id: 's1',
      installment_number: 1,
      due_date: ayer,
      expected_gross_amount: 500,
      expected_commissionable_amount: 470,
      status: 'collected',
      is_monitoring: false,
      flagged_delinquent: false,
    },
    // Vencida AYER sin cobrar → impago (el cron marca overdue el día siguiente al vencimiento).
    {
      id: 'q2',
      sale_id: 's1',
      installment_number: 2,
      due_date: ayer,
      expected_gross_amount: 500,
      expected_commissionable_amount: 470,
      status: 'pending',
      is_monitoring: false,
      flagged_delinquent: false,
    },
    {
      id: 'q3',
      sale_id: 's1',
      installment_number: 3,
      due_date: enUnMes,
      expected_gross_amount: 497,
      expected_commissionable_amount: 467,
      status: 'pending',
      is_monitoring: false,
      flagged_delinquent: false,
    },
  ]
  // solo la 1ª cobrada, la 2ª vencida sin cobrar → impago
  const plan = planCuotasDeVenta(cuotas, coleccionesReales([cuotas[0]]), metaBase)
  assert.equal(plan.fuente, 'real')
  assert.equal(plan.cuotas[0].estado, 'collected')
  assert.equal(plan.cuotas[1].estado, 'overdue')
  assert.equal(plan.cuotas[2].estado, 'pending')
  assert.equal(plan.cobrado, 500)
  assert.equal(plan.porCobrar, 997)
  assert.equal(plan.impagado, 500)
})

test('calendario REAL: flagged_delinquent manda como impago aunque el status diga pending', () => {
  const cuotas = [
    {
      id: 'q1',
      sale_id: 's1',
      installment_number: 1,
      due_date: '2026-10-01',
      expected_gross_amount: 300,
      expected_commissionable_amount: 280,
      status: 'pending',
      is_monitoring: false,
      flagged_delinquent: true,
    },
  ]
  const plan = planCuotasDeVenta(cuotas, [], metaBase)
  assert.equal(plan.cuotas[0].estado, 'overdue')
  assert.equal(plan.impagado, 300)
})

test('PREVISIÓN derivada: pago único 1/1, cubierta por el cobro real → verde', () => {
  const cobro = {
    id: 'c1',
    sale_id: 's1',
    expected_installment_id: null,
    collected_at: '2026-09-05T10:00:00Z',
    gross_amount: 1497,
    commissionable_amount: 1400,
    status: 'collected',
    processing_fee: 0,
    extra_fee: 0,
  }
  const plan = planCuotasDeVenta([], [cobro], metaBase)
  assert.equal(plan.fuente, 'prevision')
  assert.equal(plan.cuotas.length, 1)
  assert.equal(plan.cuotas[0].estado, 'collected')
  assert.equal(plan.cuotas[0].vencimiento, '2026-09-05')
  assert.equal(plan.cobrado, 1497)
  assert.equal(plan.porCobrar, 0)
})

test('PREVISIÓN derivada: plan de 6 pagos a 2026-09-05 → 6 cuotas mensuales, 1 cobrada y 5 por recolectar', () => {
  const cobro = {
    id: 'c1',
    sale_id: 's1',
    expected_installment_id: null,
    collected_at: '2026-09-05T10:00:00Z',
    gross_amount: 249.5,
    commissionable_amount: 240,
    status: 'collected',
    processing_fee: 0,
    extra_fee: 0,
  }
  const plan = planCuotasDeVenta([], [cobro], {
    ...metaBase,
    grossAmount: 1497,
    paymentPlan: { number_of_payments: 6, method: null },
  })
  assert.equal(plan.cuotas.length, 6)
  assert.equal(plan.cuotas[0].estado, 'collected')
  assert.equal(plan.cuotas[1].estado, 'pending')
  assert.equal(plan.cuotas[1].vencimiento, '2026-10-05')
  assert.equal(plan.cuotas[5].vencimiento, '2027-02-05')
  assert.equal(plan.cobrado, 249.5)
  assert.equal(plan.porCobrar, 1247.5)
})

test('PREVISIÓN derivada: cuotas vencidas sin cobrar → impago en rojo', () => {
  const cobro = {
    id: 'c1',
    sale_id: 's1',
    expected_installment_id: null,
    collected_at: '2026-05-05T10:00:00Z',
    gross_amount: 250,
    commissionable_amount: 250,
    status: 'collected',
    processing_fee: 0,
    extra_fee: 0,
  }
  const plan = planCuotasDeVenta([], [cobro], {
    ...metaBase,
    grossAmount: 1000,
    saleDate: '2026-05-05',
    paymentPlan: { number_of_payments: 4, method: null },
  })
  assert.equal(plan.cuotas[0].estado, 'collected')
  // cuotas 2 (jun) y 3 (jul) ya vencidas sin cobrar → impago; la 4 (ago) puede estar vencida según hoy
  const impagas = plan.cuotas.filter((c) => c.estado === 'overdue')
  assert.ok(impagas.length >= 2, `esperaba ≥2 impagas, hay ${impagas.length}`)
  assert.ok(plan.impagado > 0)
})

test('PREVISIÓN derivada: los cobros cubren FIFO aunque vengan en desorden', () => {
  const cobros = [
    {
      id: 'c2',
      sale_id: 's1',
      expected_installment_id: null,
      collected_at: '2026-10-06T10:00:00Z',
      gross_amount: 500,
      commissionable_amount: 500,
      status: 'collected',
      processing_fee: 0,
      extra_fee: 0,
    },
    {
      id: 'c1',
      sale_id: 's1',
      expected_installment_id: null,
      collected_at: '2026-09-05T10:00:00Z',
      gross_amount: 500,
      commissionable_amount: 500,
      status: 'collected',
      processing_fee: 0,
      extra_fee: 0,
    },
  ]
  const plan = planCuotasDeVenta([], cobros, {
    ...metaBase,
    grossAmount: 1500,
    paymentPlan: { number_of_payments: 3, method: null },
  })
  assert.equal(plan.cuotas[0].estado, 'collected')
  assert.equal(plan.cuotas[1].estado, 'collected')
  assert.equal(plan.cuotas[2].estado, 'pending')
  assert.equal(plan.cobrado, 1000)
  assert.equal(plan.porCobrar, 500)
})
