// Convierte un pago de Stripe ya clasificado como `registrable` en las filas que hay que escribir.
//
// POR QUÉ ES UN MÓDULO PURO. Aquí se decide el importe comisionable, el plazo de devolución y la
// referencia de pago: los tres son datos financieros, y quiero poder probarlos sin base de datos ni
// llamadas a Stripe. La ruta solo obedece.
//
// LO QUE SIGUE SIN INVENTARSE. El producto y el plan de pago los elige una persona: `sales` los exige
// (NOT NULL) y un pago de Stripe no dice a cuál corresponde. Esto no adivina ninguno de los dos; los
// recibe.
import type { BackfillRow } from '@/lib/finance/stripeBackfill'

/**
 * Días entre la venta y el fin del plazo de devolución. Es la misma constante que aplica el registro
 * manual de ventas (app/[tenant]/ventas/registro/nueva): si aquí fuera otra, el mismo pago tendría
 * distinto plazo según por dónde se registrara.
 */
export const REFUND_WINDOW_DAYS = 15

export type ImportChoice = {
  productId: string
  paymentPlanId: string
  /** `cash_collection_ratio` del plan elegido: la parte del bruto que genera comisión. */
  cashCollectionRatio: number
  paymentMethod: string | null
  tenantId: string
  userId: string
}

export type SaleInsert = {
  tenant_id: string
  contact_id: string
  product_id: string
  payment_plan_id: string
  sale_date: string
  refund_deadline_at: string
  gross_amount: number
  expected_commissionable_amount: number
  payment_method: string | null
  status: 'active'
  created_by: string
  notes: string
}

export type CollectionInsert = {
  tenant_id: string
  sale_id: string
  collected_at: string
  gross_amount: number
  commissionable_amount: number
  payment_method: string | null
  payment_provider: 'stripe'
  /** La referencia del pago en Stripe. Es lo que hace el registro IDEMPOTENTE. */
  payment_reference: string
  is_confirmed: true
  status: 'collected'
}

const money = (n: number) => Math.round(n * 100) / 100

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * UNA VENTA A PARTIR DE LOS PAGOS DE UN MISMO CLIENTE.
 *
 * EL BUG QUE ARREGLA. Antes esto construía una venta por CADA pago, y la ruta la escribía tal cual.
 * En un negocio que cobra 1497€ en plazos, una clienta que paga 3 × 499€ quedaba como TRES ventas de
 * 499€ en vez de UNA de 1497€. En la base real eso dejó 48 ventas para 27 clientas: el número de
 * ventas inflado un 78%, el ticket medio hundido de ~1497€ a 458€, y con él el CAC, el LTV, la tasa
 * de cierre por llamada y las comisiones — todas las métricas que se calculan por venta.
 *
 * EL MODELO CORRECTO, que es el que ya usa el registro manual: la VENTA es el compromiso (el
 * importe total pactado) y cada COBRO es un pago de ese compromiso. Los plazos son cobros, no
 * ventas. Por eso `collections` tiene `sale_id` y no al revés.
 *
 * QUÉ AGRUPA Y QUÉ NO. Agrupa los pagos del MISMO contacto dentro de la MISMA tanda. No toca ventas
 * que ya existan: una segunda compra real (un upsell, una renovación) se registra aparte y con su
 * propio plan, y fusionarla contra una venta anterior sería inventar que no hubo segunda compra.
 * La ruta avisa cuando el contacto ya tenía venta, para que lo decida una persona.
 *
 * - `sale_date` es la del PRIMER pago: es cuando se cerró la venta. Usar el último movería la venta
 *   de mes cada vez que entra un plazo.
 * - `gross_amount` es la SUMA de los pagos de la tanda. Es lo cobrado, no lo prometido: si faltan
 *   plazos por venir, la venta crece cuando entren, que es exactamente lo que hace el registro
 *   manual con los cobros pendientes.
 *
 * Devuelve error en vez de filas cuando algún pago no es registrable: la ruta vuelve a clasificar
 * antes de escribir, así que esto es la última red — pero una red que devuelve "no" es mejor que
 * una que confía.
 */
export function buildSaleFromPayments(
  rows: BackfillRow[],
  choice: ImportChoice
): { sale: SaleInsert; references: string[] } | { error: string } {
  if (rows.length === 0) return { error: 'No hay pagos que registrar.' }

  const contactIds = new Set(rows.map((r) => r.contactId))
  if (contactIds.size > 1) {
    return { error: 'Los pagos de una misma venta tienen que ser del mismo contacto.' }
  }

  // Cada pago pasa la MISMA validación de siempre. Si uno solo no es registrable, no se escribe la
  // venta a medias: se devuelve el motivo y la tanda lo reporta.
  for (const row of rows) {
    const uno = buildSaleFromPayment(row, choice)
    if ('error' in uno) return { error: uno.error }
  }

  const ordenados = [...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const saleDate = ordenados[0].createdAt.slice(0, 10)
  const total = money(ordenados.reduce((acc, r) => acc + r.amount, 0))
  const references = ordenados.map((r) => r.paymentId)

  return {
    references,
    sale: {
      tenant_id: choice.tenantId,
      contact_id: ordenados[0].contactId as string,
      product_id: choice.productId,
      payment_plan_id: choice.paymentPlanId,
      sale_date: saleDate,
      refund_deadline_at: addDaysIso(saleDate, REFUND_WINDOW_DAYS),
      gross_amount: total,
      expected_commissionable_amount: money(total * choice.cashCollectionRatio),
      payment_method: choice.paymentMethod,
      status: 'active',
      created_by: choice.userId,
      notes:
        references.length === 1
          ? `Registrada desde Stripe (${references[0]}).`
          : `Registrada desde Stripe: ${references.length} pagos (${references.join(', ')}).`,
    },
  }
}

/**
 * Validación y filas de UN pago suelto. Se sigue usando como la comprobación por pago que hace
 * `buildSaleFromPayments` antes de agrupar.
 */
export function buildSaleFromPayment(
  row: BackfillRow,
  choice: ImportChoice
): { sale: SaleInsert; reference: string } | { error: string } {
  if (row.verdict !== 'registrable') {
    return { error: `El pago ${row.paymentId} ya no es registrable (${row.verdict}).` }
  }
  if (!row.contactId) return { error: `El pago ${row.paymentId} no tiene contacto identificado.` }
  if (!(row.amount > 0)) return { error: `El pago ${row.paymentId} no tiene importe.` }

  const saleDate = row.createdAt.slice(0, 10)
  return {
    reference: row.paymentId,
    sale: {
      tenant_id: choice.tenantId,
      contact_id: row.contactId,
      product_id: choice.productId,
      payment_plan_id: choice.paymentPlanId,
      // La fecha de venta es la del PAGO, no la de hoy: registrar un cobro de marzo como venta de
      // hoy movería la facturación de mes y descuadraría el P&L.
      sale_date: saleDate,
      refund_deadline_at: addDaysIso(saleDate, REFUND_WINDOW_DAYS),
      gross_amount: money(row.amount),
      expected_commissionable_amount: money(row.amount * choice.cashCollectionRatio),
      payment_method: choice.paymentMethod,
      status: 'active',
      created_by: choice.userId,
      notes: `Registrada desde Stripe (${row.paymentId}).`,
    },
  }
}

/** El cobro que acompaña a la venta. Sin él, la venta existiría sin dinero asociado. */
export function buildCollection(row: BackfillRow, saleId: string, choice: ImportChoice): CollectionInsert {
  return {
    tenant_id: choice.tenantId,
    sale_id: saleId,
    collected_at: row.createdAt,
    gross_amount: money(row.amount),
    commissionable_amount: money(row.amount * choice.cashCollectionRatio),
    payment_method: choice.paymentMethod,
    payment_provider: 'stripe',
    // Con esta referencia, el informe vuelve a clasificar el pago como `ya_registrado` y no se puede
    // registrar dos veces.
    payment_reference: row.paymentId,
    is_confirmed: true,
    status: 'collected',
  }
}
