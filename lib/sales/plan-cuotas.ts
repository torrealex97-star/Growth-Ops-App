// PLAN DE COBRO DE UNA VENTA — una sola fuente de verdad para ficha de contacto,
// detalle de venta y cualquier vista que deba mostrar "cobrado vs por cobrar" con fechas.
//
// La tabla `sale_expected_installments` es el calendario REAL cuando existe (se materializa
// al registrar ventas financiadas/sequra y la mantienen payments/mark + el cron de
// recordatorios). Pero la mayoría de ventas históricas (pago único, reserva, Stripe) no la
// tienen: para esas se DERIVA una previsión a partir del plan de pago (`payment_plans`)
// y los cobros ya registrados (`collections`), con el mismo criterio que el registro de
// ventas: pago único → 1 cuota = la venta; reserva → 1 cuota; N pagos → N cuotas mensuales
// desde la fecha de venta (el resto, si lo hubo, entra como su propia cuota #1).
//
// Clasificación de cada cuota (la que pide el propietario, 22-sep):
//   · Cobrada (verde)     → status 'collected' (o cuota derivada cubierta por cobros reales).
//   · Por recolectar      → 'pending' con vencimiento hoy o futuro.
//   · Impago (rojo)       → 'overdue' / flagged_delinquent (real) o vencida sin cobrar (derivada).
// Cuando una cuota impagada se marca cobrada (payments/mark), pasa a verde y vuelve a sumar.

import type { Collection, PaymentPlan, SaleExpectedInstallment } from '@/lib/types/database'

export type EstadoCuota = 'collected' | 'pending' | 'overdue'

export type CuotaReal = SaleExpectedInstallment & {
  // La columna existe en BD (payments/mark la escribe) pero el tipo manual de
  // database.ts no la declara: se declara aquí para el cálculo de impago.
  flagged_delinquent?: boolean | null
}

export type CuotaPlan = {
  numero: number
  vencimiento: string | null // ISO date (YYYY-MM-DD)
  bruto: number
  comisionable: number
  estado: EstadoCuota
  /** true si la fila viene de sale_expected_installments (calendario real, gestionable) */
  real: boolean
  /** true si fue marcada como morosa (flagged_delinquent) por cobros */
  morosa: boolean
}

export type PlanCuotas = {
  /** 'real' = calendario materializado; 'prevision' = derivado de plan+cobros */
  fuente: 'real' | 'prevision'
  cuotas: CuotaPlan[]
  cobrado: number // suma bruto de cuotas cobradas
  porCobrar: number // suma bruto de cuotas no cobradas (incluye impagos)
  impagado: number // suma bruto de cuotas en impago
  proximoVencimiento: string | null
}

const redondear = (n: number) => Math.round(n * 100) / 100

const hoyISO = () => new Date().toISOString().split('T')[0]

/**
 * Compone el plan de cuotas de una venta.
 * @param plan real (sale_expected_installments) de la venta, si existe.
 * @param cobros collections de la venta (status != reversed).
 * @param meta datos de la venta para derivar la previsión cuando no hay plan real.
 */
export function planCuotasDeVenta(
  cuotasReales: CuotaReal[],
  cobros: Collection[],
  meta: {
    grossAmount: number
    saleDate: string
    paymentPlan: Pick<PaymentPlan, 'number_of_payments' | 'method'> | null
    installmentsCount: number | null
    installmentsStartDate: string | null
  } | null
): PlanCuotas {
  const cobrosValidos = cobros.filter((c) => c.status !== 'reversed')

  // ── CALENDARIO REAL ── sale_expected_installments manda cuando existe.
  if (cuotasReales.length > 0) {
    const cobrosPorCuota = new Map<string, number>()
    for (const c of cobrosValidos) {
      if (!c.expected_installment_id) continue
      cobrosPorCuota.set(
        c.expected_installment_id,
        (cobrosPorCuota.get(c.expected_installment_id) ?? 0) + Number(c.gross_amount || 0)
      )
    }
    const hoy = hoyISO()
    const ordenadas = [...cuotasReales].sort((a, b) => a.installment_number - b.installment_number)
    let cobrado = 0
    let porCobrar = 0
    let impagado = 0
    let proximoVencimiento: string | null = null

    const cuotas: CuotaPlan[] = ordenadas.map((q) => {
      // Impago: overdue, flag de moroso, o vencida sin cobrar (aunque el cron aún no la
      // haya pasado a overdue — la vista nunca pinta verde-amarillo lo que ya venció).
      const vencidaSinCobrar = q.status === 'pending' && !!q.due_date && q.due_date < hoy
      const impago = q.status === 'overdue' || vencidaSinCobrar || (q.flagged_delinquent && q.status !== 'collected')
      // Cobrada real: status collected O cubierta por cobros vinculados (fallback defensivo).
      const cubierta = (cobrosPorCuota.get(q.id) ?? 0) >= Number(q.expected_gross_amount || 0) - 0.01
      const estado: EstadoCuota = impago ? 'overdue' : q.status === 'collected' || cubierta ? 'collected' : 'pending'

      if (estado === 'collected') cobrado += Number(q.expected_gross_amount || 0)
      else {
        porCobrar += Number(q.expected_gross_amount || 0)
        if (estado === 'overdue') impagado += Number(q.expected_gross_amount || 0)
        else if (q.due_date && (!proximoVencimiento || q.due_date < proximoVencimiento)) proximoVencimiento = q.due_date
      }
      return {
        numero: q.installment_number,
        vencimiento: q.due_date,
        bruto: Number(q.expected_gross_amount || 0),
        comisionable: Number(q.expected_commissionable_amount || 0),
        estado,
        real: true,
        morosa: !!q.flagged_delinquent && estado !== 'collected',
      }
    })

    return {
      fuente: 'real',
      cuotas,
      cobrado: redondear(cobrado),
      porCobrar: redondear(porCobrar),
      impagado: redondear(impagado),
      proximoVencimiento,
    }
  }

  // ── PREVISIÓN DERIVADA ── sin calendario materializado: reparte el bruto de la venta
  // en las cuotas que implicaba su plan y las cubre en orden con los cobros reales (FIFO).
  if (!meta || !(Number(meta.grossAmount) > 0)) {
    return { fuente: 'prevision', cuotas: [], cobrado: 0, porCobrar: 0, impagado: 0, proximoVencimiento: null }
  }

  const gross = Number(meta.grossAmount)
  const metodo = meta.paymentPlan?.method ?? null
  const esReserva = metodo === 'reserva'
  // Pago único / reserva: 1 cuota. N pagos del plan: N cuotas. installments_count (autofinanciado) manda si está.
  const nCuotas = Math.max(1, meta.installmentsCount ?? meta.paymentPlan?.number_of_payments ?? 1)

  // Fechas: cuota 1 = fecha de venta. Sin installments_start_date las siguientes son
  // mensuales desde la venta (misma regla que calculateExpectedInstallments: cuota i =
  // venta + (i-1) meses). Con installments_start_date (autofinanciado) el resto empieza ahí
  // (buildRestInstallments: primera cuota del resto = startDate, siguientes mensuales).
  const fechaVenta = meta.saleDate
  const inicioCuotas = meta.installmentsStartDate ?? fechaVenta
  const fechas: string[] = []
  for (let i = 0; i < nCuotas; i++) {
    if (i === 0) {
      fechas.push(fechaVenta)
      continue
    }
    const d = new Date(inicioCuotas + 'T00:00:00Z')
    d.setUTCMonth(d.getUTCMonth() + (meta.installmentsStartDate ? i - 1 : i))
    fechas.push(d.toISOString().split('T')[0])
  }

  // Reparto: misma cuantía salvo la reserva (su importe es la 1ª cuota y el resto se reparte).
  const importes: number[] = []
  if (esReserva) {
    importes.push(gross) // la reserva se registró como cobro del total; una sola cuota
  } else {
    const per = Math.floor((gross / nCuotas) * 100) / 100
    let asignado = 0
    for (let i = 0; i < nCuotas; i++) {
      const importe = i === nCuotas - 1 ? redondear(gross - asignado) : per
      asignado += per
      importes.push(importe)
    }
  }

  // Cobros reales en orden cronológico: cubren las cuotas previstas en orden (FIFO).
  const cobrosOrdenados = [...cobrosValidos].sort(
    (a, b) => new Date(a.collected_at).getTime() - new Date(b.collected_at).getTime()
  )
  let pendienteCubrir = importes.map((importe) => importe)
  const cobradoPorCuota = importes.map(() => 0)
  for (const cobro of cobrosOrdenados) {
    let resto = Number(cobro.gross_amount || 0)
    for (let i = 0; i < pendienteCubrir.length && resto > 0.005; i++) {
      const aplicado = Math.min(resto, pendienteCubrir[i])
      pendienteCubrir[i] -= aplicado
      cobradoPorCuota[i] += aplicado
      resto -= aplicado
    }
  }

  const hoy = hoyISO()
  let cobrado = 0
  let porCobrar = 0
  let impagado = 0
  let proximoVencimiento: string | null = null

  const cuotas: CuotaPlan[] = importes.map((importe, i) => {
    const resta = pendienteCubrir[i] > 0.005
    const vencida = !!fechas[i] && fechas[i] < hoy && resta
    const estado: EstadoCuota = !resta ? 'collected' : vencida ? 'overdue' : 'pending'
    if (estado === 'collected') cobrado += importe
    else {
      porCobrar += importe
      if (estado === 'overdue') impagado += importe
      else if (!proximoVencimiento || (fechas[i] && fechas[i] < proximoVencimiento)) proximoVencimiento = fechas[i]
    }
    return {
      numero: i + 1,
      vencimiento: fechas[i],
      bruto: importe,
      comisionable: importe, // previsión: el comisionable se determina al cobrar (fee real)
      estado,
      real: false,
      morosa: false,
    }
  })

  return {
    fuente: 'prevision',
    cuotas,
    cobrado: redondear(cobrado),
    porCobrar: redondear(porCobrar),
    impagado: redondear(impagado),
    proximoVencimiento,
  }
}
