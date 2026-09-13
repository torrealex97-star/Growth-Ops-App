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
 * Filas a escribir para UN pago. Devuelve error en vez de fila cuando el pago no es registrable: la
 * ruta vuelve a clasificar antes de escribir, así que esto es la última red — pero una red que
 * devuelve "no" es mejor que una que confía.
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
